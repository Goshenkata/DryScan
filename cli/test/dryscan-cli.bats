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
}

teardown() {
  if [[ -n "${UI_PID:-}" ]] && kill -0 "${UI_PID}" 2>/dev/null; then
    kill "${UI_PID}" 2>/dev/null || true
    wait "${UI_PID}" 2>/dev/null || true
  fi
  rm -rf "${TEST_ROOT}"
}

run_dryscan() {
  run node "${CLI_BIN}" "$@"
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

  (node "${CLI_BIN}" dupes --ui "${TEST_ROOT}" >"${BATS_TMPDIR}/ui-${BATS_TEST_NUMBER}.log" 2>&1) &
  UI_PID=$!
  wait_for_ui
  curl -sf "http://localhost:3000/api/duplicates" >"${BATS_TMPDIR}/ui-${BATS_TEST_NUMBER}-resp.json"
  [ -s "${BATS_TMPDIR}/ui-${BATS_TEST_NUMBER}-resp.json" ]
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
  [[ "${updated_get_user}" == *"Updated for test coverage"* ]]
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

  cat > .dryconfig.json <<'JSON'
{
  "excludedPaths": ["**/model/**"],
  "excludedPairs": ["FUNCTION|getUserById(arity:1)|getUserById(arity:1)"],
  "minLines": 10,
  "minBlockLines": 6,
  "threshold": 0.99,
  "embeddingModel": "embeddinggemma",
  "embeddingBaseUrl": "http://localhost:11434"
}
JSON

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

  cat > .dryconfig.json <<'JSON'
{
  "excludedPaths": [],
  "excludedPairs": ["FUNCTION|getUserById(arity:1)|getUserById(arity:1)"],
  "minLines": 3,
  "minBlockLines": 5,
  "threshold": 0.85,
  "embeddingModel": "embeddinggemma",
  "embeddingBaseUrl": "http://localhost:11434"
}
JSON

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
cfg = json.loads(pathlib.Path('.dryconfig.json').read_text())
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
