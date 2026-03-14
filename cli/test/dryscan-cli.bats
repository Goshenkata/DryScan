#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../.." && pwd)"
  CLI_BIN="${REPO_ROOT}/cli/dist/cli.js"
  FIXTURE_SRC="${REPO_ROOT}/cli/test/test-java-project"
  TEST_ROOT="${REPO_ROOT}/cli/test/test-java-project-temp-${BATS_TEST_NUMBER}"
  DRY_DIR="${TEST_ROOT}/.dry"

  if [[ ! -f "${CLI_BIN}" ]]; then
    skip "Build the CLI first (npm run build) to create ${CLI_BIN}"
  fi

  rm -rf "${TEST_ROOT}"
  cp -a "${FIXTURE_SRC}" "${TEST_ROOT}"
  cd "${TEST_ROOT}"
  write_base_config
}

teardown() {
  if [[ -n "${UI_PID:-}" ]] && kill -0 "${UI_PID}" 2>/dev/null; then
    kill "${UI_PID}" 2>/dev/null || true
    wait "${UI_PID}" 2>/dev/null || true
  fi
  rm -rf "${TEST_ROOT}"
}

run_dryscan() {
  run node "${CLI_BIN}" --debug "$@"
}

sqlite_query() {
  sqlite3 "${DRY_DIR}/index.db" "$1"
}

wait_for_ui() {
  for _ in $(seq 1 15); do
    if curl -sf "http://localhost:3000/api/duplicates" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

embedding_source() {
  # Use HuggingFace by default for tests
  echo "ollama"
}

write_base_config() {
  cat > dryconfig.json <<EOF
{
  "embeddingSource": "$(embedding_source)"
}
EOF
}

@test "init builds index with tracked files" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
  [ -f "${DRY_DIR}/index.db" ]

  files_count=$(sqlite_query "SELECT COUNT(*) FROM files;")
  [ "${files_count}" -eq 5 ]

  user_units=$(sqlite_query "SELECT COUNT(*) FROM index_units WHERE name='UserService';")
  [ "${user_units}" -gt 0 ]
}

@test "dupes outputs text json and ui" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  run_dryscan dupes "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"DUPLICATION SCORE"* ]]

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"\"threshold\""* ]]
  [[ "${output}" == *"\"duplicates\""* ]]

  run_dryscan dupes --html "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"<!DOCTYPE html>"* ]]
  [[ "${output}" == *"DryScan Duplicate Report"* ]]
  [[ "${output}" != *"Exclude this pair"* ]]
  [[ "${output}" != *"regenerate-btn"* ]]
  
  # Verify logs don't pollute HTML output (capture only stdout)
  html_output=$(node "${CLI_BIN}" dupes --html "${TEST_ROOT}" 2>/dev/null)
  [[ "${html_output}" != *"[DryScan]"* ]]

  (node "${CLI_BIN}" dupes --ui "${TEST_ROOT}" >"${BATS_TMPDIR}/ui-${BATS_TEST_NUMBER}.log" 2>&1) &
  UI_PID=$!
  wait_for_ui
  curl -sf "http://localhost:3000/api/duplicates" >"${BATS_TMPDIR}/ui-${BATS_TEST_NUMBER}-resp.json"
  [ -s "${BATS_TMPDIR}/ui-${BATS_TEST_NUMBER}-resp.json" ]
}

@test "json and html stdout are not polluted by logs" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  json_out="${BATS_TMPDIR}/json-${BATS_TEST_NUMBER}.out"
  json_err="${BATS_TMPDIR}/json-${BATS_TEST_NUMBER}.err"
  html_out="${BATS_TMPDIR}/html-${BATS_TEST_NUMBER}.out"
  html_err="${BATS_TMPDIR}/html-${BATS_TEST_NUMBER}.err"

  node "${CLI_BIN}" --debug dupes --json "${TEST_ROOT}" >"${json_out}" 2>"${json_err}"
  [ "$?" -eq 0 ]
  [[ "$(cat "${json_out}")" == *"\"duplicates\""* ]]
  [[ "$(cat "${json_out}")" != *"[DryScan]"* ]]
  [[ "$(cat "${json_out}")" != *"Debugger attached."* ]]
  node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1],"utf8"));' "${json_out}"
  [[ "$(cat "${json_err}")" == *"[DryScan]"* ]]

  node "${CLI_BIN}" --debug dupes --html "${TEST_ROOT}" >"${html_out}" 2>"${html_err}"
  [ "$?" -eq 0 ]
  [[ "$(cat "${html_out}")" == *"<!DOCTYPE html>"* ]]
  [[ "$(cat "${html_out}")" != *"[DryScan]"* ]]
  [[ "$(cat "${html_out}")" != *"Debugger attached."* ]]
  [[ "$(cat "${html_err}")" == *"[DryScan]"* ]]
}

@test "update tracks removals additions modifications" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  rm -f src/main/java/com/example/demo/model/Product.java

  cat > src/main/java/com/example/demo/model/Invoice.java <<'EOF'
package com.example.demo.model;

public class Invoice {
    private Long id;
    private Double amount;

    public Invoice(Long id, Double amount) {
        this.id = id;
        this.amount = amount;
    }

    public Long getId() { return id; }
    public Double getAmount() { return amount; }
}
EOF

  cat > src/main/java/com/example/demo/service/UserService.java <<'EOF'
package com.example.demo.service;

import com.example.demo.model.User;
import com.example.demo.model.Order;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class UserService {

    private Map<Long, User> userDatabase = new HashMap<>();

    public UserService() {
        userDatabase.put(1L, new User(1L, "Alice", "alice@example.com"));
        userDatabase.put(2L, new User(2L, "Bob", "bob@example.com"));
    }

    public User getUserById(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("User ID cannot be null");
        }
        User user = userDatabase.get(id);
        if (user == null) {
            throw new NoSuchElementException("User not found with id: " + id);
        }
        return user;
    }

    public String extractUserIdFromToken(String token) {
        if (token == null || token.isEmpty()) {
            return null;
        }
        // Updated for test coverage
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Invalid JWT token format");
        }
        String payload = parts[1];
        byte[] decodedBytes = Base64.getDecoder().decode(payload);
        String decodedPayload = new String(decodedBytes);
        int userIdIndex = decodedPayload.indexOf("\"userId\":");
        if (userIdIndex == -1) {
            return null;
        }
        int startQuote = decodedPayload.indexOf("\"", userIdIndex + 9);
        int endQuote = decodedPayload.indexOf("\"", startQuote + 1);
        return decodedPayload.substring(startQuote + 1, endQuote);
    }

    public Order getOrderForUser(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("User ID is required");
        }
        return new Order(100L + userId, "ORD-" + userId, 99.99 * userId);
    }
}
EOF

  run_dryscan update "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  product_in_files=$(sqlite_query "SELECT COUNT(*) FROM files WHERE filePath LIKE '%Product.java';")
  [ "${product_in_files}" -eq 0 ]

  invoice_in_files=$(sqlite_query "SELECT COUNT(*) FROM files WHERE filePath LIKE '%Invoice.java';")
  [ "${invoice_in_files}" -eq 1 ]

  invoice_units=$(sqlite_query "SELECT COUNT(*) FROM index_units WHERE filePath LIKE '%Invoice.java%';")
  [ "${invoice_units}" -gt 0 ]

  updated_get_user=$(sqlite_query "SELECT code FROM index_units WHERE name='UserService.extractUserIdFromToken' AND filePath LIKE '%UserService.java%' LIMIT 1;")
  [ -n "${updated_get_user}" ]
  [[ "${updated_get_user}" != *"AccountService"* ]]
}

@test "dupes reruns update when project changes" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  cat > src/main/java/com/example/demo/service/NewHelper.java <<'EOF'
package com.example.demo.service;

public class NewHelper {
    public String greeting(String name) {
        return "Hello " + name;
    }
}
EOF

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  helper_present=$(sqlite_query "SELECT COUNT(*) FROM files WHERE filePath LIKE '%NewHelper.java';")
  [ "${helper_present}" -eq 1 ]
}

@test "config options influence duplicate detection" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
  units_before=$(sqlite_query "SELECT COUNT(*) FROM index_units;")

  cat > dryconfig.json <<EOF
{
  "excludedPaths": ["**/model/**"],
  "excludedPairs": ["FUNCTION|getUserById(arity:1)|getUserById(arity:1)"],
  "minLines": 10,
  "minBlockLines": 6,
  "threshold": 0.99,
  "embeddingSource": "$(embedding_source)"
}
EOF

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *"\"threshold\": 0.99"* ]]

  units_after=$(sqlite_query "SELECT COUNT(*) FROM index_units;")
  [ "${units_after}" -lt "${units_before}" ]

  model_units=$(sqlite_query "SELECT COUNT(*) FROM index_units WHERE filePath LIKE '%/model/%';")
  [ "${model_units}" -eq 0 ]

  small_getters=$(sqlite_query "SELECT COUNT(*) FROM index_units WHERE name='getId' AND filePath LIKE '%User.java%';")
  [ "${small_getters}" -eq 0 ]
}

@test "clean removes stale excluded pairs after code changes" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  cat > dryconfig.json <<EOF
{
  "excludedPaths": [],
  "excludedPairs": ["FUNCTION|getUserById(arity:1)|getUserById(arity:1)"],
  "minLines": 3,
  "minBlockLines": 5,
  "threshold": 0.85,
  "embeddingSource": "$(embedding_source)"
}
EOF

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  cat > src/main/java/com/example/demo/service/UserService.java <<'EOF'
package com.example.demo.service;

import com.example.demo.model.User;
import com.example.demo.model.Order;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class UserService {

    private Map<Long, User> userDatabase = new HashMap<>();

    public UserService() {
        userDatabase.put(1L, new User(1L, "Alice", "alice@example.com"));
        userDatabase.put(2L, new User(2L, "Bob", "bob@example.com"));
    }

    public User getUserByIdentifier(Long id) {
        if (id == null) {
            throw new IllegalArgumentException("User ID cannot be null");
        }
        User user = userDatabase.get(id);
        if (user == null) {
            throw new NoSuchElementException("User not found with id: " + id);
        }
        return user;
    }

    public String extractUserIdFromToken(String token) {
        if (token == null || token.isEmpty()) {
            return null;
        }
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Invalid JWT token format");
        }
        String payload = parts[1];
        byte[] decodedBytes = Base64.getDecoder().decode(payload);
        String decodedPayload = new String(decodedBytes);
        int userIdIndex = decodedPayload.indexOf("\"userId\":");
        if (userIdIndex == -1) {
            return null;
        }
        int startQuote = decodedPayload.indexOf("\"", userIdIndex + 9);
        int endQuote = decodedPayload.indexOf("\"", startQuote + 1);
        return decodedPayload.substring(startQuote + 1, endQuote);
    }

    public Order getOrderForUser(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("User ID is required");
        }
        return new Order(100L + userId, "ORD-" + userId, 99.99 * userId);
    }
}
EOF

  run_dryscan clean "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  remaining_pairs=$(python - <<'PY'
import json, pathlib
cfg = json.loads(pathlib.Path('dryconfig.json').read_text())
print(len(cfg.get('excludedPairs', [])))
PY
  )
  [ "${remaining_pairs}" -eq 0 ]
}

@test "gitignore rules are respected on init and update" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  initial_files=$(sqlite_query "SELECT COUNT(*) FROM files;")
  [ "${initial_files}" -gt 0 ]

  cat > .gitignore <<'EOF'
src/main/java/com/example/demo/service/**
EOF

  mkdir -p src/main/java/com/example/demo/model
  cat > src/main/java/com/example/demo/model/.gitignore <<'EOF'
User.java
EOF

  run_dryscan update "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  service_files=$(sqlite_query "SELECT COUNT(*) FROM files WHERE filePath LIKE '%/service/%';")
  [ "${service_files}" -eq 0 ]

  user_model=$(sqlite_query "SELECT COUNT(*) FROM files WHERE filePath LIKE '%/model/User.java';")
  [ "${user_model}" -eq 0 ]

  remaining=$(sqlite_query "SELECT COUNT(*) FROM files;")
  [ "${remaining}" -lt "${initial_files}" ]
}

@test "context length skips embeddings for oversized units" {
  cat > dryconfig.json <<EOF
{
  "contextLength": 32,
  "embeddingSource": "$(embedding_source)"
}
EOF

  cat > src/main/java/com/example/demo/service/OversizedService.java <<'EOF'
package com.example.demo.service;

public class OversizedService {

    public String giantMethod() {
        // filler to push code length well beyond the configured context limit
        String value = "";
        value += "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        value += "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        value += "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        value += "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
        value += "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
        return value;
    }

    public String helper() {
        return "ok";
    }
}
EOF

  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  oversized_is_null=$(sqlite_query "SELECT embedding IS NULL FROM index_units WHERE name='OversizedService.giantMethod' LIMIT 1;")
  [ "${oversized_is_null}" -eq 1 ]

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]
}

@test "detects duplicates" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  run_dryscan dupes --json "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  parsed=$(printf '%s' "${output}" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const start=d.indexOf("{");const end=d.lastIndexOf("}");if(start===-1||end===-1||end<start) process.exit(1);const j=JSON.parse(d.slice(start,end+1));process.stdout.write(`${j.score.score} ${j.score.duplicateGroups}`);});')
  score=$(printf '%s' "${parsed}" | cut -d' ' -f1)
  duplicate_groups=$(printf '%s' "${parsed}" | cut -d' ' -f2)

  [ "${score}" != "" ]
  [ "${duplicate_groups}" -eq 2 ]
  node -e 'const score=Number(process.argv[1]); if (!(score > 5)) process.exit(1);' "${score}"
}

@test "skips dto-only classes and members" {
  cat > dryconfig.json <<EOF
{
  "minLines": 0,
  "minBlockLines": 0,
  "embeddingSource": "$(embedding_source)"
}
EOF

  mkdir -p src/main/java/com/example/demo/model
  cat > src/main/java/com/example/demo/model/CustomerDto.java <<'EOF'
package com.example.demo.model;

public class CustomerDto {
    private String id;
    private String name;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
EOF

  mkdir -p src/main/java/com/example/demo/service
  cat > src/main/java/com/example/demo/service/Worker.java <<'EOF'
package com.example.demo.service;

public class Worker {
    public String doWork() {
        return "working";
    }
}
EOF

  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  dto_units=$(sqlite_query "SELECT COUNT(*) FROM index_units WHERE name LIKE 'CustomerDto%';")
  [ "${dto_units}" -eq 0 ]

  worker_units=$(sqlite_query "SELECT COUNT(*) FROM index_units WHERE name LIKE 'Worker.%';")
  [ "${worker_units}" -gt 0 ]
}

@test "second dupes execution is faster with report reuse" {
  run_dryscan init "${TEST_ROOT}"
  [ "${status}" -eq 0 ]

  # First execution: baseline (no prior report)
  first_out="${BATS_TMPDIR}/dupes-first-${BATS_TEST_NUMBER}.out"
  first_err="${BATS_TMPDIR}/dupes-first-${BATS_TEST_NUMBER}.err"
  first_start=$(date +%s%N)
  node "${CLI_BIN}" --debug dupes --json "${TEST_ROOT}" >"${first_out}" 2>"${first_err}"
  first_end=$(date +%s%N)
  first_time_ms=$(( (first_end - first_start) / 1000000 ))

  # Verify first execution succeeded
  [ -s "${first_out}" ]
  [[ "$(cat "${first_out}")" == *"\"duplicates\""* ]]

  # Second execution: should be faster (no file changes, reuse clean-clean from report)
  second_out="${BATS_TMPDIR}/dupes-second-${BATS_TEST_NUMBER}.out"
  second_err="${BATS_TMPDIR}/dupes-second-${BATS_TEST_NUMBER}.err"
  second_start=$(date +%s%N)
  node "${CLI_BIN}" --debug dupes --json "${TEST_ROOT}" >"${second_out}" 2>"${second_err}"
  second_end=$(date +%s%N)
  second_time_ms=$(( (second_end - second_start) / 1000000 ))

  # Verify second execution succeeded
  [ -s "${second_out}" ]
  [[ "$(cat "${second_out}")" == *"\"duplicates\""* ]]

  # Check for reuse message in stderr (debug logs)
  [[ "$(cat "${second_err}")" == *"Reusing clean-clean duplicates from latest report"* ]]

  # Second should be faster than first
  [ "${second_time_ms}" -lt "${first_time_ms}" ]

  # Log the speedup for visibility
  delta_ms=$(( first_time_ms - second_time_ms ))
  percent=$(( (delta_ms * 100) / first_time_ms ))
  echo "Second execution faster by ${delta_ms}ms (~${percent}%)"
}

@test "parallel cosine uses GPU backend and reports worker-vs-gpu timing" {
  npm --prefix "${REPO_ROOT}/core" run build >/dev/null
  [ "$?" -eq 0 ]

  bench_script="${BATS_TMPDIR}/parallel-sim-bench-${BATS_TEST_NUMBER}.mjs"
  cat > "${bench_script}" <<'EOF'
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const repoRoot = process.env.DRYSCAN_REPO_ROOT;
if (!repoRoot) {
  throw new Error('Missing DRYSCAN_REPO_ROOT');
}

const moduleUrl = pathToFileURL(`${repoRoot}/core/dist/services/ParallelSimilarity.js`).href;
const { parallelCosineSimilarity } = await import(moduleUrl);

const rows = Number(process.env.DRYSCAN_BENCH_ROWS || '384');
const cols = Number(process.env.DRYSCAN_BENCH_COLS || '384');
const measuredRuns = Number(process.env.DRYSCAN_BENCH_RUNS || '3');

const makeMatrix = (r, c, seed) => Array.from({ length: r }, (_, i) =>
  Array.from({ length: c }, (_, j) => {
    const x = Math.sin((i + 1) * (j + 1) * seed) + Math.cos((i + seed) * 0.37);
    return x;
  })
);

const A = makeMatrix(rows, cols, 0.17);
const B = makeMatrix(rows, cols, 0.23);

// Warmup to reduce startup noise for the measured run.
await parallelCosineSimilarity(A, B);

let totalMs = 0;
let matrix = null;
for (let i = 0; i < measuredRuns; i++) {
  const t0 = performance.now();
  matrix = await parallelCosineSimilarity(A, B);
  totalMs += performance.now() - t0;
}
const elapsedMs = totalMs / measuredRuns;

if (!Array.isArray(matrix) || matrix.length !== rows) {
  throw new Error(`Unexpected result shape: ${Array.isArray(matrix) ? matrix.length : 'not-array'}`);
}

process.stdout.write(JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)), rows, cols, measuredRuns }));
EOF

  worker_out="${BATS_TMPDIR}/worker-bench-${BATS_TEST_NUMBER}.json"
  worker_err="${BATS_TMPDIR}/worker-bench-${BATS_TEST_NUMBER}.err"
  DEBUG="DryScan:ParallelSimilarity" DRYSCAN_REPO_ROOT="${REPO_ROOT}" DRYSCAN_SIM_BACKEND="worker" node "${bench_script}" >"${worker_out}" 2>"${worker_err}"
  [ "$?" -eq 0 ]
  [[ "$(cat "${worker_err}")" == *"SIM_TRY backend=worker"* ]]
  [[ "$(cat "${worker_err}")" == *"SIM_DONE backend=worker"* ]]

  gpu_out="${BATS_TMPDIR}/gpu-bench-${BATS_TEST_NUMBER}.json"
  gpu_err="${BATS_TMPDIR}/gpu-bench-${BATS_TEST_NUMBER}.err"
  DEBUG="DryScan:ParallelSimilarity" DRYSCAN_REPO_ROOT="${REPO_ROOT}" DRYSCAN_SIM_BACKEND="gpu" node "${bench_script}" >"${gpu_out}" 2>"${gpu_err}"
  [ "$?" -eq 0 ]
  # Strict assertion: GPU path must finish on GPU with no fallback.
  [[ "$(cat "${gpu_err}")" == *"SIM_TRY backend=gpu"* ]]
  [[ "$(cat "${gpu_err}")" == *"SIM_DONE backend=gpu"* ]]
  [[ "$(cat "${gpu_err}")" != *"SIM_FAIL backend=gpu"* ]]
  [[ "$(cat "${gpu_err}")" != *"SIM_CHAIN continue_after=gpu-fail next=worker"* ]]

  worker_ms=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(d.elapsedMs));' "${worker_out}")
  gpu_ms=$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(d.elapsedMs));' "${gpu_out}")

  delta_ms=$(node -e 'const w=Number(process.argv[1]); const g=Number(process.argv[2]); process.stdout.write(String(Math.round((w-g)*100)/100));' "${worker_ms}" "${gpu_ms}")
  speedup_pct=$(node -e 'const w=Number(process.argv[1]); const g=Number(process.argv[2]); const p=((w-g)/w)*100; process.stdout.write(String(Math.round(p*100)/100));' "${worker_ms}" "${gpu_ms}")
  direction=$(node -e 'const w=Number(process.argv[1]); const g=Number(process.argv[2]); if (g < w) process.stdout.write("faster"); else if (g > w) process.stdout.write("slower"); else process.stdout.write("equal");' "${worker_ms}" "${gpu_ms}")
  
  # Echo results and logs to stdout so bats captures them
  cat <<BENCH
================================================================================
GPU Benchmark Results
================================================================================
Worker avg: ${worker_ms}ms
GPU avg:    ${gpu_ms}ms
Delta:      ${delta_ms}ms
Speedup:    ${speedup_pct}% (gpu is ${direction})

WORKER DEBUG LOGS:
----------------
BENCH
  cat "${worker_err}"
  
  cat <<BENCH

GPU DEBUG LOGS:
---------------
BENCH
  cat "${gpu_err}"
  
  cat <<BENCH
================================================================================
BENCH
}
