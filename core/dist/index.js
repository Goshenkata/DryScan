import {
  __decorateClass,
  similarityApi
} from "./chunk-23WZ5D5H.js";

// src/DryScan.ts
import upath6 from "upath";
import fs8 from "fs/promises";

// src/const.ts
var DRYSCAN_DIR = ".dry";
var INDEX_DB = "index.db";
var REPORTS_DIR = "reports";
var FILE_CHECKSUM_ALGO = "md5";
var BLOCK_HASH_ALGO = "sha1";

// src/IndexUnitExtractor.ts
import path2 from "path";
import fs3 from "fs/promises";
import upath4 from "upath";
import crypto2 from "crypto";
import debug2 from "debug";
import { glob as glob2 } from "glob-gitignore";

// src/extractors/java.ts
import crypto from "crypto";
import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import debug from "debug";

// src/config/indexConfig.ts
var indexConfig = {
  blockMinLines: 5,
  thresholds: {
    class: 0.88,
    function: 0.88,
    block: 0.88
  },
  weights: {
    class: { self: 1 },
    function: { self: 0.8, parentClass: 0.2 },
    block: { self: 0.7, parentFunction: 0.2, parentClass: 0.1 }
  }
};

// src/config/configStore.ts
import upath2 from "upath";

// src/config/dryconfig.ts
import fs from "fs/promises";
import upath from "upath";
import { Validator } from "jsonschema";
var DEFAULT_CONFIG = {
  excludedPaths: [
    "**/test/**"
  ],
  excludedPairs: [],
  minLines: 3,
  minBlockLines: 5,
  threshold: 0.8,
  embeddingSource: "http://localhost:11434",
  contextLength: 2048,
  enableLLMFilter: true
};
var validator = new Validator();
var partialConfigSchema = {
  type: "object",
  properties: {
    excludedPaths: { type: "array", items: { type: "string" } },
    excludedPairs: { type: "array", items: { type: "string" } },
    minLines: { type: "number" },
    minBlockLines: { type: "number" },
    threshold: { type: "number" },
    embeddingSource: { type: "string" },
    contextLength: { type: "number" },
    enableLLMFilter: { type: "boolean" }
  }
};
var fullConfigSchema = {
  ...partialConfigSchema,
  required: [
    "excludedPaths",
    "excludedPairs",
    "minLines",
    "minBlockLines",
    "threshold",
    "embeddingSource",
    "contextLength",
    "enableLLMFilter"
  ]
};
function validateConfig(raw, schema, source) {
  const result = validator.validate(raw, schema);
  if (!result.valid) {
    const details = result.errors.map((e) => e.stack).join("; ");
    throw new Error(`${source} config is invalid: ${details}`);
  }
  return raw;
}
async function readConfigFile(repoPath) {
  const configPath = upath.join(repoPath, "dryconfig.json");
  try {
    const content = await fs.readFile(configPath, "utf8");
    let parsed = {};
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      throw new Error(`Invalid JSON in ${configPath}: ${parseErr.message}`);
    }
    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") {
      return {};
    }
    throw err;
  }
}
async function resolveDryConfig(repoPath) {
  const fileConfigRaw = await readConfigFile(repoPath);
  validateConfig(fileConfigRaw, partialConfigSchema, "Config file");
  const merged = { ...DEFAULT_CONFIG, ...fileConfigRaw };
  validateConfig(merged, fullConfigSchema, "Merged");
  return merged;
}
async function saveDryConfig(repoPath, config) {
  const configPath = upath.join(repoPath, "dryconfig.json");
  validateConfig(config, fullConfigSchema, "Config to save");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}
async function ensureDefaultConfig(repoPath) {
  const configPath = upath.join(repoPath, "dryconfig.json");
  const repoExists = await fs.stat(repoPath).then((s) => s.isDirectory()).catch((err) => {
    if (err?.code === "ENOENT") return false;
    throw err;
  });
  if (!repoExists) return;
  const exists = await fs.stat(configPath).then(() => true).catch((err) => {
    if (err?.code === "ENOENT") return false;
    throw err;
  });
  if (!exists) {
    await saveDryConfig(repoPath, DEFAULT_CONFIG);
  }
}

// src/config/configStore.ts
var ConfigStore = class {
  cache = /* @__PURE__ */ new Map();
  loading = /* @__PURE__ */ new Map();
  async init(repoPath) {
    const key = this.normalize(repoPath);
    return this.load(key, repoPath);
  }
  async get(repoPath) {
    const key = this.normalize(repoPath);
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.load(key, repoPath);
  }
  async refresh(repoPath) {
    const key = this.normalize(repoPath);
    this.cache.delete(key);
    return this.load(key, repoPath);
  }
  async save(repoPath, config) {
    const key = this.normalize(repoPath);
    await saveDryConfig(repoPath, config);
    this.cache.set(key, config);
  }
  async load(key, repoPath) {
    const existing = this.loading.get(key);
    if (existing) return existing;
    const promise = ensureDefaultConfig(repoPath).then(() => resolveDryConfig(repoPath)).then((config) => {
      this.cache.set(key, config);
      this.loading.delete(key);
      return config;
    }).catch((err) => {
      this.loading.delete(key);
      throw err;
    });
    this.loading.set(key, promise);
    return promise;
  }
  normalize(repoPath) {
    return upath2.normalizeTrim(upath2.resolve(repoPath));
  }
};
var configStore = new ConfigStore();

// src/extractors/java.ts
var log = debug("DryScan:JavaExtractor");
var JavaExtractor = class {
  id = "java";
  exts = [".java"];
  parser;
  repoPath;
  config;
  constructor(repoPath) {
    this.repoPath = repoPath;
    this.parser = new Parser();
    this.parser.setLanguage(Java);
  }
  supports(filePath) {
    const lower = filePath.toLowerCase();
    return this.exts.some((ext) => lower.endsWith(ext));
  }
  async extractFromText(fileRelPath, source) {
    if (!source.trim()) return [];
    this.config = await configStore.get(this.repoPath);
    let tree;
    try {
      tree = this.parser.parse(source);
    } catch (err) {
      log("Skipping %s: tree-sitter parse failed (%s)", fileRelPath, err.message);
      return [];
    }
    const units = [];
    const visit = (node, currentClass) => {
      if (this.isClassNode(node)) {
        const className = this.getClassName(node, source) || "<anonymous>";
        if (this.isDtoClass(node, source, className)) {
          return;
        }
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;
        const classLength = endLine - startLine;
        const skipClass = this.shouldSkip("class" /* CLASS */, className, classLength);
        const classId = this.buildId("class" /* CLASS */, fileRelPath, className, startLine, endLine);
        const code = this.stripComments(this.stripClassBody(node, source));
        const classUnit = {
          id: classId,
          name: className,
          filePath: fileRelPath,
          startLine,
          endLine,
          code,
          unitType: "class" /* CLASS */,
          children: []
        };
        if (!skipClass) {
          units.push(classUnit);
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) visit(child, skipClass ? void 0 : classUnit);
        }
        return;
      }
      if (this.isFunctionNode(node)) {
        const fnUnit = this.buildFunctionUnit(node, source, fileRelPath, currentClass);
        const fnLength = fnUnit.endLine - fnUnit.startLine;
        const bodyNode = this.getFunctionBody(node);
        const fnArity = this.getNodeArity(node);
        const skipFunction = this.shouldSkip("function" /* FUNCTION */, fnUnit.name, fnLength, fnArity);
        if (skipFunction) {
          return;
        }
        units.push(fnUnit);
        if (bodyNode) {
          const blocks = this.extractBlocks(bodyNode, source, fileRelPath, fnUnit);
          units.push(...blocks);
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child, currentClass);
      }
    };
    visit(tree.rootNode);
    return this.removeDuplicates(units);
  }
  unitLabel(unit) {
    if (unit.unitType === "class" /* CLASS */) return unit.filePath;
    if (unit.unitType === "function" /* FUNCTION */) return this.canonicalFunctionSignature(unit);
    if (unit.unitType === "block" /* BLOCK */) return this.normalizedBlockHash(unit);
    return unit.name;
  }
  isClassNode(node) {
    return node.type === "class_declaration";
  }
  getClassName(node, source) {
    const nameNode = node.childForFieldName?.("name");
    return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : null;
  }
  isFunctionNode(node) {
    return node.type === "method_declaration" || node.type === "constructor_declaration";
  }
  getFunctionName(node, source, parentClass) {
    const nameNode = node.childForFieldName?.("name");
    const nameText = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
    return parentClass ? `${parentClass.name}.${nameText}` : nameText;
  }
  getFunctionBody(node) {
    return node.childForFieldName?.("body") ?? null;
  }
  isBlockNode(node) {
    return node.type === "block";
  }
  getMethodBodiesForClass(node) {
    const bodies = [];
    const classBody = node.children.find((child) => child.type === "class_body");
    if (!classBody) return bodies;
    for (let i = 0; i < classBody.namedChildCount; i++) {
      const child = classBody.namedChild(i);
      if (!child) continue;
      if (child.type === "method_declaration" || child.type === "constructor_declaration") {
        const body = child.childForFieldName?.("body");
        if (body) bodies.push(body);
      }
    }
    return bodies;
  }
  canonicalFunctionSignature(unit) {
    const arity = this.extractArity(unit.code);
    return `${unit.name}(arity:${arity})`;
  }
  normalizedBlockHash(unit) {
    const normalized = this.normalizeCode(unit.code);
    return crypto.createHash(BLOCK_HASH_ALGO).update(normalized).digest("hex");
  }
  shouldSkip(unitType, name, lineCount, arity) {
    if (!this.config) {
      throw new Error("Config not loaded before skip evaluation");
    }
    const config = this.config;
    const minLines = unitType === "block" /* BLOCK */ ? Math.max(indexConfig.blockMinLines, config.minBlockLines ?? 0) : config.minLines;
    const belowMin = minLines > 0 && lineCount < minLines;
    const trivial = unitType === "function" /* FUNCTION */ && this.isTrivialFunction(name, arity ?? 0);
    return belowMin || trivial;
  }
  /**
   * A function is trivial if it follows a simple accessor pattern:
   * - getters/isers: name matches get[A-Z] or is[A-Z] with exactly 0 parameters
   * - setters: name matches set[A-Z] with at most 1 parameter
   * Methods like getUserById(Long id) have arity > 0 and are NOT trivial.
   */
  isTrivialFunction(fullName, arity) {
    const simpleName = fullName.split(".").pop() || fullName;
    const isGetter = /^(get|is)[A-Z]/.test(simpleName) && arity === 0;
    const isSetter = /^set[A-Z]/.test(simpleName) && arity <= 1;
    return isGetter || isSetter;
  }
  /** Counts the formal parameters of a method or constructor node. */
  getNodeArity(node) {
    const params = node.childForFieldName?.("parameters");
    if (!params) return 0;
    return params.namedChildren.filter((c) => c.type === "formal_parameter" || c.type === "spread_parameter").length;
  }
  isDtoClass(node, source, className) {
    const classBody = node.children.find((child) => child.type === "class_body");
    if (!classBody) return false;
    let hasField = false;
    for (let i = 0; i < classBody.namedChildCount; i++) {
      const child = classBody.namedChild(i);
      if (!child) continue;
      if (child.type === "field_declaration") {
        hasField = true;
        continue;
      }
      if (child.type.includes("annotation")) {
        continue;
      }
      if (child.type === "method_declaration" || child.type === "constructor_declaration") {
        const simpleName = this.getSimpleFunctionName(child, source);
        const fullName = `${className}.${simpleName}`;
        const arity = this.getNodeArity(child);
        if (!this.isTrivialFunction(fullName, arity)) {
          return false;
        }
        continue;
      }
      return false;
    }
    return hasField;
  }
  getSimpleFunctionName(node, source) {
    const nameNode = node.childForFieldName?.("name");
    return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
  }
  buildFunctionUnit(node, source, file, parentClass) {
    const name = this.getFunctionName(node, source, parentClass) || "<anonymous>";
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;
    const id = this.buildId("function" /* FUNCTION */, file, name, startLine, endLine);
    const unit = {
      id,
      name,
      filePath: file,
      startLine,
      endLine,
      children: [],
      code: this.stripComments(source.slice(node.startIndex, node.endIndex)),
      unitType: "function" /* FUNCTION */,
      parentId: parentClass?.id,
      parent: parentClass
    };
    if (parentClass) {
      parentClass.children = parentClass.children || [];
      parentClass.children.push(unit);
    }
    return unit;
  }
  extractBlocks(bodyNode, source, file, parentFunction) {
    const blocks = [];
    const visit = (n) => {
      if (this.isBlockNode(n)) {
        const startLine = n.startPosition.row;
        const endLine = n.endPosition.row;
        const lineCount = endLine - startLine;
        if (this.shouldSkip("block" /* BLOCK */, parentFunction.name, lineCount)) {
          return;
        }
        if (lineCount >= indexConfig.blockMinLines) {
          const id = this.buildId("block" /* BLOCK */, file, parentFunction.name, startLine, endLine);
          const blockUnit = {
            id,
            name: parentFunction.name,
            filePath: file,
            startLine,
            endLine,
            code: this.stripComments(source.slice(n.startIndex, n.endIndex)),
            unitType: "block" /* BLOCK */,
            parentId: parentFunction.id,
            parent: parentFunction
          };
          const contextLength = this.config?.contextLength ?? 2048;
          const splitBlocks = this.textSplitBlockIfOverContextLimit(blockUnit, contextLength);
          parentFunction.children = parentFunction.children || [];
          parentFunction.children.push(...splitBlocks);
          blocks.push(...splitBlocks);
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) visit(child);
      }
    };
    visit(bodyNode);
    return blocks;
  }
  stripClassBody(node, source) {
    const classStart = node.startIndex;
    let code = source.slice(classStart, node.endIndex);
    const methodBodies = [];
    const candidates = this.getMethodBodiesForClass(node);
    for (const body of candidates) {
      methodBodies.push({ start: body.startIndex - classStart, end: body.endIndex - classStart });
    }
    methodBodies.sort((a, b) => b.start - a.start);
    for (const body of methodBodies) {
      code = code.slice(0, body.start) + " { }" + code.slice(body.end);
    }
    return code;
  }
  buildId(type, filePath, name, startLine, endLine) {
    const pathKey = this.pathKeyForId(filePath);
    const scopedName = this.scopeNameWithPath(type, pathKey, name);
    return `${type}:${scopedName}:${startLine}-${endLine}`;
  }
  pathKeyForId(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.replace(/\.[^./]+$/, "");
  }
  scopeNameWithPath(type, pathKey, name) {
    if (type === "class" /* CLASS */) {
      return pathKey;
    }
    const classLeaf = pathKey.split("/").pop() ?? pathKey;
    if (name === classLeaf) {
      return pathKey;
    }
    if (name.startsWith(`${classLeaf}.`)) {
      return `${pathKey}${name.slice(classLeaf.length)}`;
    }
    return `${pathKey}.${name}`;
  }
  extractArity(code) {
    const match = code.match(/^[^{]*?\(([^)]*)\)/s);
    if (!match) return 0;
    const params = match[1].split(",").map((p) => p.trim()).filter(Boolean);
    return params.length;
  }
  normalizeCode(code) {
    const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
    return withoutLineComments.replace(/\s+/g, "");
  }
  stripComments(code) {
    const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n\r]/g, ""));
    return withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
  }
  removeDuplicates(units) {
    return Array.from(new Map(units.map((u) => [u.id, u])).values());
  }
  /** Splits a block unit's code into chunks if it exceeds the context length limit. */
  textSplitBlockIfOverContextLimit(unit, contextLength) {
    if (unit.code.length <= contextLength) return [unit];
    const chunks = [];
    let chunkIndex = 0;
    for (let i = 0; i < unit.code.length; i += contextLength) {
      chunks.push({
        ...unit,
        id: `${unit.id}:chunk${chunkIndex}`,
        code: unit.code.slice(i, i + contextLength)
      });
      chunkIndex++;
    }
    return chunks;
  }
};

// src/Gitignore.ts
import path from "path";
import fs2 from "fs/promises";
import upath3 from "upath";
import { glob } from "glob-gitignore";
import ignore from "ignore";
var Gitignore = class {
  constructor(root) {
    this.root = root;
  }
  defaultIgnores = [".git/**", ".dry/**"];
  async buildMatcher(config) {
    const rules = await this.resolveRules(config);
    return ignore({ allowRelativePaths: true }).add(rules);
  }
  async resolveRules(config) {
    const gitignoreRules = await this.loadGitignoreRules();
    const configRules = config.excludedPaths || [];
    return [...this.defaultIgnores, ...gitignoreRules, ...configRules];
  }
  async loadGitignoreRules() {
    const gitignoreFiles = await glob("**/.gitignore", {
      cwd: this.root,
      dot: true,
      nodir: true,
      ignore: this.defaultIgnores
    });
    const rules = [];
    for (const file of gitignoreFiles) {
      const absPath = path.join(this.root, file);
      const dir = upath3.normalizeTrim(upath3.dirname(file));
      const content = await fs2.readFile(absPath, "utf8").catch(() => "");
      const lines = content.split(/\r?\n/);
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const negated = trimmed.startsWith("!");
        const body = negated ? trimmed.slice(1) : trimmed;
        const scoped = this.scopeRule(body, dir);
        if (!scoped) continue;
        rules.push(negated ? `!${scoped}` : scoped);
      }
    }
    return rules;
  }
  scopeRule(rule, gitignoreDir) {
    const cleaned = rule.replace(/^\//, "");
    if (!cleaned) return null;
    if (!gitignoreDir || gitignoreDir === ".") {
      return cleaned;
    }
    return upath3.normalizeTrim(upath3.join(gitignoreDir, cleaned));
  }
};

// src/IndexUnitExtractor.ts
var log2 = debug2("DryScan:Extractor");
function defaultExtractors(repoPath) {
  return [new JavaExtractor(repoPath)];
}
var IndexUnitExtractor = class {
  root;
  extractors;
  gitignore;
  constructor(rootPath, extractors) {
    this.root = rootPath;
    this.extractors = extractors ?? defaultExtractors(rootPath);
    this.gitignore = new Gitignore(this.root);
    log2("Initialized extractor for %s", this.root);
  }
  /**
   * Lists all supported source files from a path. Honors exclusion globs from config.
   */
  async listSourceFiles(dirPath) {
    const target = await this.resolveTarget(dirPath);
    const config = await this.loadConfig();
    const ignoreMatcher = await this.gitignore.buildMatcher(config);
    if (target.stat.isFile()) {
      return this.filterSingleFile(target.baseRel, ignoreMatcher);
    }
    const matches = await this.globSourceFiles(target.baseRel);
    return this.filterSupportedFiles(matches, ignoreMatcher);
  }
  /**
   * Computes MD5 checksum of file content to track changes.
   */
  async computeChecksum(filePath) {
    const fullPath = path2.isAbsolute(filePath) ? filePath : path2.join(this.root, filePath);
    const content = await fs3.readFile(fullPath, "utf8");
    return crypto2.createHash(FILE_CHECKSUM_ALGO).update(content).digest("hex");
  }
  /**
   * Scans a file or directory and extracts indexable units using the matching LanguageExtractor.
   * The returned units have repo-relative file paths and no embedding attached.
   */
  async scan(targetPath) {
    const fullPath = path2.isAbsolute(targetPath) ? targetPath : path2.join(this.root, targetPath);
    const stat = await fs3.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }
    if (stat.isDirectory()) {
      log2("Scanning directory %s", fullPath);
      return this.scanDirectory(fullPath);
    }
    return this.scanFile(fullPath);
  }
  /**
   * Scans a directory recursively, extracting units from supported files while honoring exclusions.
   */
  async scanDirectory(dir) {
    const out = [];
    const relDir = this.relPath(dir);
    const files = await this.listSourceFiles(relDir);
    for (const relFile of files) {
      const absFile = path2.join(this.root, relFile);
      const extracted = await this.tryScanSupportedFile(absFile);
      out.push(...extracted);
    }
    return out;
  }
  /**
   * Scans a single file and extracts supported units.
   */
  async scanFile(filePath) {
    return this.tryScanSupportedFile(filePath, true);
  }
  /**
   * Extracts units from a supported file.
   * Optionally throws when the file type is unsupported (used when scanning an explicit file).
   */
  async tryScanSupportedFile(filePath, throwOnUnsupported = false) {
    const extractor = this.extractors.find((ex) => ex.supports(filePath));
    if (!extractor) {
      if (throwOnUnsupported) {
        throw new Error(`Unsupported file type: ${filePath}`);
      }
      return [];
    }
    const rel = this.relPath(filePath);
    if (await this.shouldExclude(rel)) {
      log2("Skipping excluded file %s", rel);
      return [];
    }
    const source = await fs3.readFile(filePath, "utf8");
    const units = await extractor.extractFromText(rel, source);
    log2("Extracted %d units from %s", units.length, rel);
    return units.map((unit) => ({
      ...unit,
      filePath: rel,
      embedding: void 0
    }));
  }
  /**
   * Converts an absolute path to a repo-relative, normalized (POSIX-style) path.
   * This keeps paths stable across platforms and consistent in the index/DB.
   */
  relPath(absPath) {
    return this.normalizeRelPath(upath4.relative(this.root, absPath));
  }
  /**
   * Returns true if a repo-relative path matches any configured exclusion glob.
   */
  async shouldExclude(relPath) {
    const config = await this.loadConfig();
    const ignoreMatcher = await this.gitignore.buildMatcher(config);
    return ignoreMatcher.ignores(this.normalizeRelPath(relPath));
  }
  async loadConfig() {
    return await configStore.get(this.root);
  }
  /**
   * Normalizes repo-relative paths and strips leading "./" to keep matcher inputs consistent.
   */
  normalizeRelPath(relPath) {
    const normalized = upath4.normalizeTrim(relPath);
    return normalized.startsWith("./") ? normalized.slice(2) : normalized;
  }
  async resolveTarget(dirPath) {
    const fullPath = path2.isAbsolute(dirPath) ? dirPath : path2.join(this.root, dirPath);
    const stat = await fs3.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }
    const baseRel = this.relPath(fullPath);
    log2("Listing source files under %s", fullPath);
    return { fullPath, baseRel, stat };
  }
  async filterSingleFile(baseRel, ignoreMatcher) {
    const relFile = this.normalizeRelPath(baseRel);
    if (ignoreMatcher.ignores(relFile)) return [];
    return this.extractors.some((ex) => ex.supports(relFile)) ? [relFile] : [];
  }
  async globSourceFiles(baseRel) {
    const pattern = baseRel ? `${baseRel.replace(/\\/g, "/")}/**/*` : "**/*";
    const matches = await glob2(pattern, {
      cwd: this.root,
      dot: false,
      nodir: true
    });
    return matches.map((p) => this.normalizeRelPath(p));
  }
  filterSupportedFiles(relPaths, ignoreMatcher) {
    return relPaths.filter((relPath) => !ignoreMatcher.ignores(relPath)).filter((relPath) => this.extractors.some((ex) => ex.supports(relPath)));
  }
};

// src/db/DryScanDatabase.ts
import "reflect-metadata";
import fs4 from "fs/promises";
import upath5 from "upath";
import { DataSource, In } from "typeorm";

// src/db/entities/FileEntity.ts
import { Entity, PrimaryColumn, Column } from "typeorm";
var FileEntity = class {
  filePath;
  checksum;
  mtime;
};
__decorateClass([
  PrimaryColumn("text")
], FileEntity.prototype, "filePath", 2);
__decorateClass([
  Column("text")
], FileEntity.prototype, "checksum", 2);
__decorateClass([
  Column("integer")
], FileEntity.prototype, "mtime", 2);
FileEntity = __decorateClass([
  Entity("files")
], FileEntity);

// src/db/entities/IndexUnitEntity.ts
import {
  Column as Column2,
  Entity as Entity2,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn as PrimaryColumn2,
  RelationId
} from "typeorm";
var IndexUnitEntity = class {
  id;
  name;
  filePath;
  startLine;
  endLine;
  code;
  unitType;
  parent;
  parentId;
  children;
  embedding;
};
__decorateClass([
  PrimaryColumn2("text")
], IndexUnitEntity.prototype, "id", 2);
__decorateClass([
  Column2("text")
], IndexUnitEntity.prototype, "name", 2);
__decorateClass([
  Column2("text")
], IndexUnitEntity.prototype, "filePath", 2);
__decorateClass([
  Column2("integer")
], IndexUnitEntity.prototype, "startLine", 2);
__decorateClass([
  Column2("integer")
], IndexUnitEntity.prototype, "endLine", 2);
__decorateClass([
  Column2("text")
], IndexUnitEntity.prototype, "code", 2);
__decorateClass([
  Column2("text")
], IndexUnitEntity.prototype, "unitType", 2);
__decorateClass([
  ManyToOne(() => IndexUnitEntity, (unit) => unit.children, {
    nullable: true,
    onDelete: "CASCADE"
  }),
  JoinColumn({ name: "parent_id" })
], IndexUnitEntity.prototype, "parent", 2);
__decorateClass([
  RelationId((unit) => unit.parent)
], IndexUnitEntity.prototype, "parentId", 2);
__decorateClass([
  OneToMany(() => IndexUnitEntity, (unit) => unit.parent, { nullable: true })
], IndexUnitEntity.prototype, "children", 2);
__decorateClass([
  Column2("simple-array", { nullable: true })
], IndexUnitEntity.prototype, "embedding", 2);
IndexUnitEntity = __decorateClass([
  Entity2("index_units")
], IndexUnitEntity);

// src/db/entities/LLMVerdictEntity.ts
import { Entity as Entity3, PrimaryColumn as PrimaryColumn3, Column as Column3 } from "typeorm";
var LLMVerdictEntity = class {
  pairKey;
  verdict;
  leftFilePath;
  rightFilePath;
  createdAt;
};
__decorateClass([
  PrimaryColumn3("text")
], LLMVerdictEntity.prototype, "pairKey", 2);
__decorateClass([
  Column3("text")
], LLMVerdictEntity.prototype, "verdict", 2);
__decorateClass([
  Column3("text")
], LLMVerdictEntity.prototype, "leftFilePath", 2);
__decorateClass([
  Column3("text")
], LLMVerdictEntity.prototype, "rightFilePath", 2);
__decorateClass([
  Column3("integer")
], LLMVerdictEntity.prototype, "createdAt", 2);
LLMVerdictEntity = __decorateClass([
  Entity3("llm_verdicts")
], LLMVerdictEntity);

// src/db/DryScanDatabase.ts
var DryScanDatabase = class {
  dataSource;
  unitRepository;
  fileRepository;
  verdictRepository;
  isInitialized() {
    return !!this.dataSource?.isInitialized;
  }
  async init(dbPath) {
    await fs4.mkdir(upath5.dirname(dbPath), { recursive: true });
    this.dataSource = new DataSource({
      type: "sqlite",
      database: dbPath,
      entities: [IndexUnitEntity, FileEntity, LLMVerdictEntity],
      synchronize: true,
      logging: false
    });
    await this.dataSource.initialize();
    this.unitRepository = this.dataSource.getRepository(IndexUnitEntity);
    this.fileRepository = this.dataSource.getRepository(FileEntity);
    this.verdictRepository = this.dataSource.getRepository(LLMVerdictEntity);
  }
  async saveUnit(unit) {
    await this.saveUnits(unit);
  }
  async saveUnits(units) {
    if (!this.unitRepository) throw new Error("Database not initialized");
    const payload = Array.isArray(units) ? units : [units];
    const BATCH_SIZE = 500;
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      console.debug(`[DryScanDatabase] Saving units ${i + 1}-${Math.min(i + BATCH_SIZE, payload.length)} of ${payload.length}...`);
      const batch = payload.slice(i, i + BATCH_SIZE);
      await this.unitRepository.save(batch);
    }
  }
  async getUnit(id) {
    if (!this.unitRepository) throw new Error("Database not initialized");
    return this.unitRepository.findOne({
      where: { id },
      relations: ["children", "parent"]
    });
  }
  async getAllUnits() {
    if (!this.unitRepository) throw new Error("Database not initialized");
    return this.unitRepository.find({ relations: ["children", "parent"] });
  }
  async updateUnit(unit) {
    await this.saveUnits(unit);
  }
  async updateUnits(units) {
    await this.saveUnits(units);
  }
  /**
   * Returns total count of indexed units.
   */
  async countUnits() {
    if (!this.unitRepository) throw new Error("Database not initialized");
    return this.unitRepository.count();
  }
  /**
   * Removes index units by their file paths.
   * Used during incremental updates when files change.
   */
  async removeUnitsByFilePaths(filePaths) {
    if (!this.unitRepository) throw new Error("Database not initialized");
    await this.unitRepository.delete({ filePath: In(filePaths) });
  }
  /**
   * Saves file metadata (path, checksum, mtime) to track changes.
   */
  async saveFile(file) {
    if (!this.fileRepository) throw new Error("Database not initialized");
    await this.fileRepository.save(file);
  }
  /**
   * Saves multiple file metadata entries.
   */
  async saveFiles(files) {
    if (!this.fileRepository) throw new Error("Database not initialized");
    await this.fileRepository.save(files);
  }
  /**
   * Gets file metadata by file path.
   */
  async getFile(filePath) {
    if (!this.fileRepository) throw new Error("Database not initialized");
    return this.fileRepository.findOne({ where: { filePath } });
  }
  /**
   * Gets all tracked files.
   */
  async getAllFiles() {
    if (!this.fileRepository) throw new Error("Database not initialized");
    return this.fileRepository.find();
  }
  /**
   * Removes file metadata entries by file paths.
   * Used when files are deleted from repository.
   */
  async removeFilesByFilePaths(filePaths) {
    if (!this.fileRepository) throw new Error("Database not initialized");
    await this.fileRepository.delete({ filePath: In(filePaths) });
  }
  // ── LLM verdict cache ──────────────────────────────────────────────────────
  /**
   * Retrieves cached LLM verdicts for the given pair keys.
   */
  async getLLMVerdicts(pairKeys) {
    if (!this.verdictRepository) throw new Error("Database not initialized");
    if (pairKeys.length === 0) return [];
    return this.verdictRepository.find({ where: { pairKey: In(pairKeys) } });
  }
  /**
   * Upserts LLM verdicts for a batch of pairs.
   */
  async saveLLMVerdicts(verdicts) {
    if (!this.verdictRepository) throw new Error("Database not initialized");
    if (verdicts.length === 0) return;
    await this.verdictRepository.save(verdicts);
  }
  /**
   * Removes all cached LLM verdicts where either side's file path matches.
   * Used to evict stale verdicts when files become dirty.
   */
  async removeLLMVerdictsByFilePaths(filePaths) {
    if (!this.dataSource?.isInitialized) throw new Error("Database not initialized");
    if (filePaths.length === 0) return;
    const placeholders = filePaths.map(() => "?").join(", ");
    await this.dataSource.query(
      `DELETE FROM llm_verdicts WHERE leftFilePath IN (${placeholders}) OR rightFilePath IN (${placeholders})`,
      [...filePaths, ...filePaths]
    );
  }
  async close() {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }
};

// src/services/RepositoryInitializer.ts
import path3 from "path";
import fs5 from "fs/promises";

// src/services/ModelConnector.ts
import debug3 from "debug";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
var log3 = debug3("DryScan:ModelConnector");
var OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
var HUGGINGFACE_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B";
var OLLAMA_CHAT_MODEL = "qwen3.5-2b-q4km:latest";
var ModelConnector = class {
  constructor(repoPath) {
    this.repoPath = repoPath;
  }
  // ── Embeddings ─────────────────────────────────────────────────────────────
  /**
   * Generates a vector embedding for a code unit.
   * Returns the unit unchanged (with `embedding: null`) if code exceeds `contextLength`.
   */
  async embed(unit) {
    const config = await configStore.get(this.repoPath);
    const maxContext = config?.contextLength ?? 2048;
    if (unit.code.length > maxContext) {
      log3("Skipping embedding for %s (code %d > context %d)", unit.id, unit.code.length, maxContext);
      return { ...unit, embedding: null };
    }
    const source = config.embeddingSource;
    if (!source) {
      throw new Error(`Embedding source is not configured for repository at ${this.repoPath}`);
    }
    const provider = this.buildEmbeddingProvider(source);
    const embedding = await provider.embedQuery(unit.code);
    return { ...unit, embedding };
  }
  // ── Chat completions ───────────────────────────────────────────────────────
  /**
   * Sends a prompt to the fine-tuned duplication classifier (qwen-duplication-2b)
   * and returns the raw response text (expected: "yes" or "no").
   *
   * Throws on non-OK HTTP status so callers can decide on fallback behaviour.
   */
  async chat(prompt) {
    const config = await configStore.get(this.repoPath);
    const baseUrl = this.resolveOllamaChatBaseUrl(config.embeddingSource);
    log3("Sending chat request to %s using model %s", baseUrl, OLLAMA_CHAT_MODEL);
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { temperature: 0, num_predict: 32 }
      })
    });
    if (!response.ok) {
      throw new Error(`Ollama chat request failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.message?.content?.trim() ?? "";
  }
  // ── Private helpers ────────────────────────────────────────────────────────
  buildEmbeddingProvider(source) {
    if (source.toLowerCase() === "huggingface") {
      log3("Using HuggingFace Inference with model: %s", HUGGINGFACE_EMBEDDING_MODEL);
      return new HuggingFaceInferenceEmbeddings({
        model: HUGGINGFACE_EMBEDDING_MODEL,
        provider: "hf-inference"
      });
    }
    const ollamaBaseUrl = this.resolveOllamaEmbeddingBaseUrl(source);
    if (ollamaBaseUrl !== null) {
      log3("Using Ollama%s with model: %s", ollamaBaseUrl ? ` at ${ollamaBaseUrl}` : "", OLLAMA_EMBEDDING_MODEL);
      return new OllamaEmbeddings({
        model: OLLAMA_EMBEDDING_MODEL,
        ...ollamaBaseUrl && { baseUrl: ollamaBaseUrl }
      });
    }
    throw new Error(
      `Unsupported embedding source: ${source || "(empty)"}. Use "huggingface" or an Ollama URL.`
    );
  }
  /**
   * For embedding providers: returns the URL string, undefined (use Ollama default), or null (not Ollama).
   */
  resolveOllamaEmbeddingBaseUrl(source) {
    if (/^https?:\/\//i.test(source)) return source;
    if (source.toLowerCase() === "ollama") return void 0;
    return null;
  }
  /**
   * For chat completions: extracts host from an HTTP URL, or falls back to localhost.
   */
  resolveOllamaChatBaseUrl(source) {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      return `${url.protocol}//${url.host}`;
    }
    return "http://localhost:11434";
  }
};

// src/services/RepositoryInitializer.ts
var RepositoryInitializer = class {
  constructor(deps, exclusionService) {
    this.deps = deps;
    this.exclusionService = exclusionService;
  }
  async init(options) {
    const extractor = this.deps.extractor;
    console.log("[DryScan] Phase 1/3: Extracting code units...");
    await this.initUnits(extractor);
    console.log("[DryScan] Phase 2/3: Computing embeddings (may be slow)...");
    await this.computeEmbeddings(options?.skipEmbeddings === true);
    console.log("[DryScan] Phase 3/3: Tracking files...");
    await this.trackFiles(extractor);
    await this.exclusionService.cleanupExcludedFiles();
    console.log("[DryScan] Initialization phases complete.");
  }
  async initUnits(extractor) {
    const units = await extractor.scan(this.deps.repoPath);
    console.log(`[DryScan] Extracted ${units.length} index units.`);
    await this.deps.db.saveUnits(units);
  }
  async computeEmbeddings(skipEmbeddings) {
    if (skipEmbeddings) {
      console.log("[DryScan] Skipping embedding computation by request.");
      return;
    }
    const allUnits = await this.deps.db.getAllUnits();
    const total = allUnits.length;
    console.log(`[DryScan] Computing embeddings for ${total} units...`);
    const updated = [];
    const progressInterval = Math.max(1, Math.ceil(total / 10));
    const connector = new ModelConnector(this.deps.repoPath);
    for (let i = 0; i < total; i++) {
      const unit = allUnits[i];
      try {
        const enriched = await connector.embed(unit);
        updated.push(enriched);
      } catch (err) {
        console.error(
          `[DryScan] Embedding failed for ${unit.filePath} (${unit.name}): ${err?.message || err}`
        );
        throw err;
      }
      const completed = i + 1;
      if (completed === total || completed % progressInterval === 0) {
        const pct = Math.floor(completed / total * 100);
        console.log(`[DryScan] Embeddings ${completed}/${total} (${pct}%)`);
      }
    }
    await this.deps.db.updateUnits(updated);
  }
  async trackFiles(extractor) {
    const allFunctions = await extractor.listSourceFiles(this.deps.repoPath);
    const fileEntities = [];
    for (const relPath of allFunctions) {
      const fullPath = path3.join(this.deps.repoPath, relPath);
      const stat = await fs5.stat(fullPath);
      const checksum = await extractor.computeChecksum(fullPath);
      const fileEntity = new FileEntity();
      fileEntity.filePath = relPath;
      fileEntity.checksum = checksum;
      fileEntity.mtime = stat.mtimeMs;
      fileEntities.push(fileEntity);
    }
    await this.deps.db.saveFiles(fileEntities);
    console.log(`[DryScan] Tracked ${fileEntities.length} files.`);
  }
};

// src/services/UpdateService.ts
import debug5 from "debug";

// src/DryScanUpdater.ts
import path4 from "path";
import fs6 from "fs/promises";
import debug4 from "debug";
var log4 = debug4("DryScan:Updater");
async function detectFileChanges(repoPath, extractor, db) {
  const currentFiles = await extractor.listSourceFiles(repoPath);
  const currentFileSet = new Set(currentFiles);
  const trackedFiles = await db.getAllFiles();
  const trackedFileMap = new Map(trackedFiles.map((f) => [f.filePath, f]));
  const added = [];
  const changed = [];
  const unchanged = [];
  for (const filePath of currentFiles) {
    const tracked = trackedFileMap.get(filePath);
    if (!tracked) {
      added.push(filePath);
      continue;
    }
    const fullPath = path4.join(repoPath, filePath);
    const stat = await fs6.stat(fullPath);
    if (stat.mtimeMs !== tracked.mtime) {
      const currentChecksum = await extractor.computeChecksum(fullPath);
      if (currentChecksum !== tracked.checksum) {
        changed.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    } else {
      unchanged.push(filePath);
    }
  }
  const deleted = trackedFiles.map((f) => f.filePath).filter((fp) => !currentFileSet.has(fp));
  return { added, changed, deleted, unchanged };
}
async function extractUnitsFromFiles(filePaths, extractor) {
  const allUnits = [];
  for (const relPath of filePaths) {
    const functions = await extractor.scan(relPath);
    allUnits.push(...functions);
  }
  return allUnits;
}
async function updateFileTracking(changeSet, repoPath, extractor, db) {
  if (changeSet.deleted.length > 0) {
    if (typeof db.removeFilesByFilePaths === "function") {
      await db.removeFilesByFilePaths(changeSet.deleted);
    } else if (typeof db.removeFiles === "function") {
      await db.removeFiles(changeSet.deleted);
    }
  }
  const filesToTrack = [...changeSet.added, ...changeSet.changed];
  if (filesToTrack.length > 0) {
    const fileEntities = [];
    for (const relPath of filesToTrack) {
      const fullPath = path4.join(repoPath, relPath);
      const stat = await fs6.stat(fullPath);
      const checksum = await extractor.computeChecksum(fullPath);
      const fileEntity = new FileEntity();
      fileEntity.filePath = relPath;
      fileEntity.checksum = checksum;
      fileEntity.mtime = stat.mtimeMs;
      fileEntities.push(fileEntity);
    }
    await db.saveFiles(fileEntities);
  }
}
async function performIncrementalUpdate(repoPath, extractor, db) {
  log4("Starting incremental update");
  const connector = new ModelConnector(repoPath);
  const changeSet = await detectFileChanges(repoPath, extractor, db);
  if (changeSet.changed.length === 0 && changeSet.added.length === 0 && changeSet.deleted.length === 0) {
    log4("No changes detected. Index is up to date.");
    return changeSet;
  }
  log4(`Changes detected: ${changeSet.added.length} added, ${changeSet.changed.length} changed, ${changeSet.deleted.length} deleted`);
  const filesToRemove = [...changeSet.changed, ...changeSet.deleted];
  if (filesToRemove.length > 0) {
    await db.removeUnitsByFilePaths(filesToRemove);
    log4(`Removed units from ${filesToRemove.length} files`);
  }
  const filesToProcess = [...changeSet.added, ...changeSet.changed];
  if (filesToProcess.length > 0) {
    const newUnits = await extractUnitsFromFiles(filesToProcess, extractor);
    await db.saveUnits(newUnits);
    log4(`Extracted and saved ${newUnits.length} units from ${filesToProcess.length} files`);
    const total = newUnits.length;
    if (total > 0) {
      log4(`Recomputing embeddings for ${total} units`);
      const progressInterval = Math.max(1, Math.ceil(total / 10));
      const updatedWithEmbeddings = [];
      for (let i = 0; i < total; i++) {
        const unit = newUnits[i];
        try {
          const enriched = await connector.embed(unit);
          updatedWithEmbeddings.push(enriched);
        } catch (err) {
          console.error(
            `[DryScan] embedding failed for ${unit.filePath} (${unit.name}): ${err?.message || err}`
          );
          throw err;
        }
        const completed = i + 1;
        if (completed === total || completed % progressInterval === 0) {
          const pct = Math.floor(completed / total * 100);
          console.log(`[DryScan] Incremental embeddings ${completed}/${total} (${pct}%)`);
        }
      }
      await db.updateUnits(updatedWithEmbeddings);
      log4(`Recomputed embeddings for ${updatedWithEmbeddings.length} units`);
    }
  }
  await updateFileTracking(changeSet, repoPath, extractor, db);
  log4("Incremental update complete");
  return changeSet;
}

// src/services/UpdateService.ts
var log5 = debug5("DryScan:UpdateService");
var UpdateService = class {
  constructor(deps, exclusionService) {
    this.deps = deps;
    this.exclusionService = exclusionService;
  }
  /** Returns the list of file paths that were modified or deleted (dirty). */
  async updateIndex() {
    const extractor = this.deps.extractor;
    try {
      const changeSet = await performIncrementalUpdate(this.deps.repoPath, extractor, this.deps.db);
      await this.exclusionService.cleanupExcludedFiles();
      const dirtyPaths = [...changeSet.changed, ...changeSet.deleted, ...changeSet.added];
      return dirtyPaths;
    } catch (err) {
      log5("Error during index update:", err);
      throw err;
    }
  }
};

// src/services/ExclusionService.ts
import { minimatch } from "minimatch";
var ExclusionService = class {
  constructor(deps) {
    this.deps = deps;
  }
  config;
  async cleanupExcludedFiles() {
    const config = await this.loadConfig();
    if (!config.excludedPaths || config.excludedPaths.length === 0) return;
    const units = await this.deps.db.getAllUnits();
    const files = await this.deps.db.getAllFiles();
    const unitPathsToRemove = /* @__PURE__ */ new Set();
    for (const unit of units) {
      if (this.pathExcluded(unit.filePath)) {
        unitPathsToRemove.add(unit.filePath);
      }
    }
    const filePathsToRemove = /* @__PURE__ */ new Set();
    for (const file of files) {
      if (this.pathExcluded(file.filePath)) {
        filePathsToRemove.add(file.filePath);
      }
    }
    const paths = [.../* @__PURE__ */ new Set([...unitPathsToRemove, ...filePathsToRemove])];
    if (paths.length > 0) {
      await this.deps.db.removeUnitsByFilePaths(paths);
      await this.deps.db.removeFilesByFilePaths(paths);
    }
  }
  async cleanExclusions() {
    const config = await this.loadConfig();
    const units = await this.deps.db.getAllUnits();
    const actualPairsByType = {
      ["class" /* CLASS */]: this.buildPairKeys(units, "class" /* CLASS */),
      ["function" /* FUNCTION */]: this.buildPairKeys(units, "function" /* FUNCTION */),
      ["block" /* BLOCK */]: this.buildPairKeys(units, "block" /* BLOCK */)
    };
    const kept = [];
    const removed = [];
    for (const entry of config.excludedPairs || []) {
      const parsed = this.deps.pairing.parsePairKey(entry);
      if (!parsed) {
        removed.push(entry);
        continue;
      }
      const candidates = actualPairsByType[parsed.type];
      const matched = candidates.some((actual) => this.deps.pairing.pairKeyMatches(actual, parsed));
      if (matched) {
        kept.push(entry);
      } else {
        removed.push(entry);
      }
    }
    const nextConfig = { ...config, excludedPairs: kept };
    await configStore.save(this.deps.repoPath, nextConfig);
    this.config = nextConfig;
    return { removed: removed.length, kept: kept.length };
  }
  pathExcluded(filePath) {
    const config = this.config;
    if (!config || !config.excludedPaths || config.excludedPaths.length === 0) return false;
    return config.excludedPaths.some((pattern) => minimatch(filePath, pattern, { dot: true }));
  }
  buildPairKeys(units, type) {
    const typed = units.filter((u) => u.unitType === type);
    const pairs = [];
    for (let i = 0; i < typed.length; i++) {
      for (let j = i + 1; j < typed.length; j++) {
        const key = this.deps.pairing.pairKeyForUnits(typed[i], typed[j]);
        const parsed = key ? this.deps.pairing.parsePairKey(key) : null;
        if (parsed) {
          pairs.push(parsed);
        }
      }
    }
    return pairs;
  }
  async loadConfig() {
    this.config = await configStore.get(this.deps.repoPath);
    return this.config;
  }
};

// src/services/PairingService.ts
import crypto3 from "crypto";
import debug6 from "debug";
import { minimatch as minimatch2 } from "minimatch";
var log6 = debug6("DryScan:pairs");
var PairingService = class {
  constructor(indexUnitExtractor) {
    this.indexUnitExtractor = indexUnitExtractor;
  }
  /**
   * Creates a stable, order-independent key for two units of the same type.
   * Returns null when units differ in type so callers can skip invalid pairs.
   */
  pairKeyForUnits(left, right) {
    if (left.unitType !== right.unitType) {
      log6("Skipping pair with mismatched types: %s vs %s", left.unitType, right.unitType);
      return null;
    }
    const type = left.unitType;
    const leftLabel = this.unitLabel(left);
    const rightLabel = this.unitLabel(right);
    const [a, b] = [leftLabel, rightLabel].sort();
    return `${type}|${a}|${b}`;
  }
  /**
   * Parses a raw pair key into its components, returning null for malformed values.
   * Sorting is applied so callers can compare pairs without worrying about order.
   */
  parsePairKey(value) {
    const parts = value.split("|");
    if (parts.length !== 3) {
      log6("Invalid pair key format: %s", value);
      return null;
    }
    const [typeRaw, leftRaw, rightRaw] = parts;
    const type = this.stringToUnitType(typeRaw);
    if (!type) {
      log6("Unknown unit type in pair key: %s", typeRaw);
      return null;
    }
    const [left, right] = [leftRaw, rightRaw].sort();
    return { type, left, right, key: `${type}|${left}|${right}` };
  }
  /**
   * Checks whether an actual pair key satisfies a pattern, with glob matching for class paths.
   */
  pairKeyMatches(actual, pattern) {
    if (actual.type !== pattern.type) return false;
    if (actual.type === "class" /* CLASS */) {
      const forward = minimatch2(actual.left, pattern.left, { dot: true }) && minimatch2(actual.right, pattern.right, { dot: true });
      const swapped = minimatch2(actual.left, pattern.right, { dot: true }) && minimatch2(actual.right, pattern.left, { dot: true });
      return forward || swapped;
    }
    return actual.left === pattern.left && actual.right === pattern.right || actual.left === pattern.right && actual.right === pattern.left;
  }
  /**
   * Derives a reversible, extractor-aware label for a unit.
   * Extractors may override; fallback uses a fixed format per unit type.
   */
  unitLabel(unit) {
    const extractor = this.findExtractor(unit.filePath);
    const customLabel = extractor?.unitLabel?.(unit);
    if (customLabel) return customLabel;
    switch (unit.unitType) {
      case "class" /* CLASS */:
        return unit.filePath;
      case "function" /* FUNCTION */:
        return this.canonicalFunctionSignature(unit);
      case "block" /* BLOCK */:
        return this.normalizedBlockHash(unit);
      default:
        return unit.name;
    }
  }
  findExtractor(filePath) {
    return this.indexUnitExtractor.extractors.find((ex) => ex.supports(filePath));
  }
  canonicalFunctionSignature(unit) {
    const arity = this.extractArity(unit.code);
    return `${unit.name}(arity:${arity})`;
  }
  /**
   * Normalizes block code (strips comments/whitespace) and hashes it for pair matching.
   */
  normalizedBlockHash(unit) {
    const normalized = this.normalizeCode(unit.code);
    return crypto3.createHash(BLOCK_HASH_ALGO).update(normalized).digest("hex");
  }
  stringToUnitType(value) {
    if (value === "class" /* CLASS */) return "class" /* CLASS */;
    if (value === "function" /* FUNCTION */) return "function" /* FUNCTION */;
    if (value === "block" /* BLOCK */) return "block" /* BLOCK */;
    return null;
  }
  extractArity(code) {
    const match = code.match(/^[^{]*?\(([^)]*)\)/s);
    if (!match) return 0;
    const params = match[1].split(",").map((p) => p.trim()).filter(Boolean);
    return params.length;
  }
  normalizeCode(code) {
    const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
    return withoutLineComments.replace(/\s+/g, "");
  }
};

// src/DryScan.ts
import { existsSync } from "fs";

// src/services/DuplicateService.ts
import debug9 from "debug";
import shortUuid from "short-uuid";

// src/services/DuplicationCache.ts
import debug7 from "debug";
var log7 = debug7("DryScan:DuplicationCache");
var DuplicationCache = class _DuplicationCache {
  static instance = null;
  comparisons = /* @__PURE__ */ new Map();
  fileIndex = /* @__PURE__ */ new Map();
  initialized = false;
  /**
   * Per-run embedding similarity matrices.
   * Stored as flat row-major Float32Array buffers to avoid V8 heap blowups.
   */
  embSimByType = /* @__PURE__ */ new Map();
  /** Per-run memoization of parent unit similarity scores (reset each run). */
  parentSimCache = /* @__PURE__ */ new Map();
  static getInstance() {
    if (!_DuplicationCache.instance) {
      _DuplicationCache.instance = new _DuplicationCache();
    }
    return _DuplicationCache.instance;
  }
  /**
   * Updates the cache with fresh duplicate groups. Not awaited by callers to avoid blocking.
   */
  async update(groups) {
    if (!groups) return;
    for (const group of groups) {
      const key = this.makeKey(group.left.id, group.right.id);
      this.comparisons.set(key, group.similarity);
      this.addKeyForFile(group.left.filePath, key);
      this.addKeyForFile(group.right.filePath, key);
    }
    this.initialized = this.initialized || groups.length > 0;
  }
  /**
   * Retrieves a cached similarity if present and valid for both file paths.
   * Returns null when the cache has not been initialized or when the pair is missing.
   */
  get(leftId, rightId, leftFilePath, rightFilePath) {
    if (!this.initialized) return null;
    const key = this.makeKey(leftId, rightId);
    if (!this.fileHasKey(leftFilePath, key) || !this.fileHasKey(rightFilePath, key)) {
      return null;
    }
    const value = this.comparisons.get(key);
    return typeof value === "number" ? value : null;
  }
  /**
   * Invalidates all cached comparisons involving the provided file paths.
   */
  async invalidate(paths) {
    if (!this.initialized || !paths || paths.length === 0) return;
    const unique = new Set(paths);
    for (const filePath of unique) {
      const keys = this.fileIndex.get(filePath);
      if (!keys) continue;
      for (const key of keys) {
        this.comparisons.delete(key);
        for (const [otherPath, otherKeys] of this.fileIndex.entries()) {
          if (otherKeys.delete(key) && otherKeys.size === 0) {
            this.fileIndex.delete(otherPath);
          }
        }
      }
      this.fileIndex.delete(filePath);
    }
    if (this.comparisons.size === 0) {
      this.initialized = false;
    }
  }
  /**
   * Clears all cached data. Intended for test setup.
   */
  clear() {
    this.comparisons.clear();
    this.fileIndex.clear();
    this.initialized = false;
    this.embSimByType.clear();
    this.clearRunCaches();
  }
  /**
   * Resets per-run memoization (parent similarities).
   * The embedding matrix is intentionally preserved so incremental runs can
   * reuse clean×clean values across calls.
   */
  clearRunCaches() {
    this.parentSimCache.clear();
  }
  /**
   * Builds or incrementally updates the embedding similarity matrix.
   *
   * Full rebuild (default): replaces the entire matrix — O(n²).
   * Incremental (dirtyPaths provided + prior matrix exists): copies clean×clean
   * cells from the old matrix and recomputes only dirty rows via one batched
   * cosineSimilarity call — O(d·n) where d = number of dirty units.
   */
  async buildEmbSimCache(units, dirtyPaths) {
    await this.buildEmbSimCacheForType(units, "class" /* CLASS */, dirtyPaths);
    await this.buildEmbSimCacheForType(units, "function" /* FUNCTION */, dirtyPaths);
    await this.buildEmbSimCacheForType(units, "block" /* BLOCK */, dirtyPaths);
  }
  async buildEmbSimCacheForType(units, unitType, dirtyPaths) {
    const embedded = units.filter(
      (u) => u.unitType === unitType && Array.isArray(u.embedding) && u.embedding.length > 0
    );
    if (embedded.length < 2) {
      this.embSimByType.delete(unitType);
      return;
    }
    const embeddings = embedded.map((u) => u.embedding);
    const newIndex = new Map(embedded.map((u, i) => [u.id, i]));
    const dirtySet = dirtyPaths ? new Set(dirtyPaths) : null;
    const prior = this.embSimByType.get(unitType);
    const hasPrior = Boolean(prior);
    const n = embedded.length;
    const canIncremental = Boolean(dirtySet && hasPrior && prior.size === n);
    if (!canIncremental) {
      const { data } = await similarityApi.parallelCosineSimilarityFlat(embeddings, embeddings, "float32");
      this.embSimByType.set(unitType, { size: n, index: newIndex, matrix: data });
      log7("Built embedding similarity matrix for %s: %d units", unitType, embedded.length);
      return;
    }
    const priorIndex = prior.index;
    let indicesStable = true;
    for (const [id, idx] of newIndex.entries()) {
      if (priorIndex.get(id) !== idx) {
        indicesStable = false;
        break;
      }
    }
    if (!indicesStable) {
      const { data } = await similarityApi.parallelCosineSimilarityFlat(embeddings, embeddings, "float32");
      this.embSimByType.set(unitType, { size: n, index: newIndex, matrix: data });
      log7("Rebuilt embedding similarity matrix for %s (index changed): %d units", unitType, embedded.length);
      return;
    }
    const dirtyIds = new Set(embedded.filter((u) => dirtySet.has(u.filePath)).map((u) => u.id));
    if (dirtyIds.size === 0) {
      log7("Matrix reused for %s: no dirty units detected", unitType);
      return;
    }
    const dirtyIndices = embedded.reduce((acc, u, i) => dirtyIds.has(u.id) ? [...acc, i] : acc, []);
    const dirtyEmbeddings = dirtyIndices.map((i) => embeddings[i]);
    const { data: dirtyRows } = await similarityApi.parallelCosineSimilarityFlat(dirtyEmbeddings, embeddings, "float32");
    const matrix = prior.matrix;
    dirtyIndices.forEach((rowIdx, di) => {
      const dirtyRowBase = di * n;
      const fullRowBase = rowIdx * n;
      for (let j = 0; j < n; j++) {
        const v = dirtyRows[dirtyRowBase + j] ?? 0;
        matrix[fullRowBase + j] = v;
        matrix[j * n + rowIdx] = v;
      }
    });
    this.embSimByType.set(unitType, { size: n, index: newIndex, matrix });
    log7("Incremental matrix update for %s: %d dirty unit(s) out of %d total", unitType, dirtyIds.size, n);
  }
  /** Returns the pre-computed cosine similarity for a pair of unit IDs, if available. */
  getEmbSim(id1, id2) {
    for (const { size, index, matrix } of this.embSimByType.values()) {
      const i = index.get(id1);
      const j = index.get(id2);
      if (i === void 0 || j === void 0) continue;
      return matrix[i * size + j];
    }
    return void 0;
  }
  /** Returns the memoized parent similarity for the given stable key, if available. */
  getParentSim(key) {
    return this.parentSimCache.get(key);
  }
  /** Stores a memoized parent similarity for the given stable key. */
  setParentSim(key, sim) {
    this.parentSimCache.set(key, sim);
  }
  addKeyForFile(filePath, key) {
    const current = this.fileIndex.get(filePath) ?? /* @__PURE__ */ new Set();
    current.add(key);
    this.fileIndex.set(filePath, current);
  }
  fileHasKey(filePath, key) {
    const keys = this.fileIndex.get(filePath);
    return keys ? keys.has(key) : false;
  }
  makeKey(leftId, rightId) {
    return [leftId, rightId].sort().join("::");
  }
};

// src/services/LLMFalsePositiveDetector.ts
import fs7 from "fs/promises";
import path5 from "path";
import debug8 from "debug";
var log8 = debug8("DryScan:LLMFalsePositiveDetector");
var CONCURRENCY_LIMIT = 20;
var LLMFalsePositiveDetector = class {
  constructor(repoPath, db) {
    this.repoPath = repoPath;
    this.db = db;
    this.connector = new ModelConnector(repoPath);
  }
  connector;
  /**
   * Classifies `candidates` as true positives or false positives.
   *
   * Cache behaviour:
   * - Pairs where NEITHER file is in `dirtyPaths` and a cached verdict exists → reuse.
   * - All other pairs → call the LLM and persist the new verdict.
   */
  async classify(candidates, dirtyPaths) {
    if (candidates.length === 0) {
      return { truePositives: [], falsePositives: [] };
    }
    const dirtySet = new Set(dirtyPaths);
    const pairKeys = candidates.map((g) => this.pairKey(g));
    const cached = await this.db.getLLMVerdicts(pairKeys);
    const verdictMap = new Map(cached.map((v) => [v.pairKey, v.verdict]));
    const toClassify = candidates.filter((g) => {
      if (dirtySet.has(g.left.filePath) || dirtySet.has(g.right.filePath)) return true;
      return !verdictMap.has(this.pairKey(g));
    });
    log8(
      "%d candidates: %d from cache, %d need classification",
      candidates.length,
      candidates.length - toClassify.length,
      toClassify.length
    );
    if (toClassify.length > 0) {
      const newVerdicts = await this.classifyWithConcurrency(toClassify);
      const entities = newVerdicts.map(
        ({ group, verdict }) => Object.assign(new LLMVerdictEntity(), {
          pairKey: this.pairKey(group),
          verdict,
          leftFilePath: group.left.filePath,
          rightFilePath: group.right.filePath,
          createdAt: Date.now()
        })
      );
      await this.db.saveLLMVerdicts(entities);
      for (const { group, verdict } of newVerdicts) {
        verdictMap.set(this.pairKey(group), verdict);
      }
    }
    const truePositives = [];
    const falsePositives = [];
    for (const group of candidates) {
      if (verdictMap.get(this.pairKey(group)) === "no") {
        falsePositives.push(group);
      } else {
        truePositives.push(group);
      }
    }
    log8("%d true positives, %d false positives", truePositives.length, falsePositives.length);
    return { truePositives, falsePositives };
  }
  /** Stable, order-independent pair key matching DuplicateService.groupKey. */
  pairKey(group) {
    return [group.left.id, group.right.id].sort().join("::");
  }
  async classifyWithConcurrency(groups) {
    const results = [];
    for (let i = 0; i < groups.length; i += CONCURRENCY_LIMIT) {
      const batch = groups.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(batch.map((g) => this.classifyPair(g)));
      results.push(...batchResults);
    }
    return results;
  }
  async classifyPair(group) {
    try {
      const prompt = await this.buildPrompt(group);
      const raw = await this.connector.chat(prompt);
      const verdict = raw.toLowerCase().startsWith("yes") ? "yes" : "no";
      log8("Pair %s \u2192 %s (raw: %s)", this.pairKey(group), verdict, raw);
      return { group, verdict };
    } catch (err) {
      log8("LLM classification error for pair %s: %s \u2014 defaulting to true positive", this.pairKey(group), err.message);
      return { group, verdict: "yes" };
    }
  }
  /**
   * Builds the inference prompt matching the training format documented in
   * DryScanDiplomna/finetune/TRAINING_FORMAT.md.
   *
   * TODO: detect language from file extension once more LanguageExtractors are added.
   *       Currently hardcoded to "java".
   */
  async buildPrompt(group) {
    const projectName = path5.basename(this.repoPath);
    const lang = "java";
    const [fileAContent, fileBContent] = await Promise.all([
      fs7.readFile(path5.join(this.repoPath, group.left.filePath), "utf8").catch(() => ""),
      fs7.readFile(path5.join(this.repoPath, group.right.filePath), "utf8").catch(() => "")
    ]);
    const lines = [
      "You are a strict code-duplication judge.",
      "",
      "Task:",
      "Decide if Snippet A and Snippet B count as duplicated code.",
      "Answer based on BOTH the snippets and their full-file context.",
      "",
      "Definition (return 'yes' if ANY apply):",
      "- Straight/near clone (small edits, renames, reformatting).",
      "- Semantic duplicate: different syntax but same behavior/intent.",
      "- Extractable duplicate: not identical, but a reasonable shared helper/abstraction could be extracted.",
      "Return 'no' ONLY if they clearly implement different responsibilities/logic and are not reasonably extractable.",
      "",
      "Output rules (mandatory):",
      "- Output EXACTLY one token: yes OR no",
      "- No punctuation, no extra words, no explanations",
      "- Think silently before answering",
      "",
      "Evidence:",
      "",
      `=== Snippet A (project=${projectName} id=${group.left.id}) ===`,
      `name: ${group.left.name}`,
      `unitType: ${group.left.unitType}`,
      `filePath: ${group.left.filePath}`,
      `lines: ${group.left.startLine}-${group.left.endLine}`,
      "```" + lang,
      group.left.code,
      "```",
      "",
      `=== Snippet B (project=${projectName} id=${group.right.id}) ===`,
      `name: ${group.right.name}`,
      `unitType: ${group.right.unitType}`,
      `filePath: ${group.right.filePath}`,
      `lines: ${group.right.startLine}-${group.right.endLine}`,
      "```" + lang,
      group.right.code,
      "```",
      "",
      `=== Full file A: ${group.left.filePath} ===`,
      "```" + lang,
      fileAContent,
      "```",
      "",
      `=== Full file B: ${group.right.filePath} ===`,
      "```" + lang,
      fileBContent,
      "```",
      "",
      "Question: Are Snippet A and Snippet B duplicated code under the definition above?",
      "Answer:"
    ];
    return lines.join("\n");
  }
};

// src/services/DuplicateService.ts
var log9 = debug9("DryScan:DuplicateService");
var DuplicateService = class {
  constructor(deps) {
    this.deps = deps;
  }
  config;
  duplicationCache = DuplicationCache.getInstance();
  async findDuplicates(config, dirtyPaths = [], previousReport) {
    this.config = config;
    const t0 = performance.now();
    const allUnits = await this.deps.db.getAllUnits();
    log9("Starting duplicate analysis on %d units", allUnits.length);
    this.duplicationCache.clearRunCaches();
    await this.duplicationCache.buildEmbSimCache(allUnits, dirtyPaths);
    if (allUnits.length < 2) {
      return { duplicates: [], score: this.computeDuplicationScore([], allUnits) };
    }
    const thresholds = this.resolveThresholds(config.threshold);
    const dirtySet = new Set(dirtyPaths);
    const canReuseFromReport = Boolean(previousReport && previousReport.threshold === config.threshold);
    const reusableClean = canReuseFromReport ? this.reuseCleanPairsFromPreviousReport(previousReport, allUnits, dirtySet) : [];
    const recomputed = this.computeDuplicates(
      allUnits,
      thresholds,
      canReuseFromReport ? dirtySet : null
    );
    const merged = this.mergeDuplicates(reusableClean, recomputed);
    const filtered = merged.filter((g) => !this.isGroupExcluded(g));
    log9(
      "Found %d duplicate groups (%d excluded, %d reused)",
      filtered.length,
      merged.length - filtered.length,
      reusableClean.length
    );
    if (config.enableLLMFilter) {
      if (dirtyPaths.length > 0) {
        void this.deps.db.removeLLMVerdictsByFilePaths(dirtyPaths).catch((err) => {
          log9("Failed to evict stale LLM verdicts: %s", err.message);
        });
      }
      const detector = new LLMFalsePositiveDetector(this.deps.repoPath, this.deps.db);
      const llmStart = performance.now();
      const decision = await detector.classify(filtered, dirtyPaths);
      const llmMs = performance.now() - llmStart;
      log9(
        "LLM filter: %d true positives, %d false positives",
        decision.truePositives.length,
        decision.falsePositives.length
      );
      const score2 = this.computeDuplicationScore(decision.truePositives, allUnits);
      log9("findDuplicates completed in %dms", (performance.now() - t0).toFixed(2));
      return this.buildResult(decision.truePositives, score2, allUnits, filtered.length, Math.round(llmMs));
    }
    const score = this.computeDuplicationScore(filtered, allUnits);
    log9("findDuplicates completed in %dms", (performance.now() - t0).toFixed(2));
    return this.buildResult(filtered, score, allUnits, filtered.length, 0);
  }
  buildResult(duplicates, score, allUnits, pairsBeforeLLM, llmFilterMs) {
    return {
      duplicates,
      score,
      metrics: {
        unitCounts: this.countUnitsByType(allUnits),
        pairsBeforeLLM,
        pairsAfterLLM: duplicates.length,
        llmFilterMs
      }
    };
  }
  resolveThresholds(functionThreshold) {
    const d = indexConfig.thresholds;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const fn = clamp(functionThreshold ?? d.function);
    return {
      function: fn,
      block: clamp(fn + d.block - d.function),
      class: clamp(fn + d.class - d.function)
    };
  }
  computeDuplicates(units, thresholds, dirtySet) {
    if (dirtySet && dirtySet.size === 0) {
      log9("Skipping recomputation: no dirty files and previous report threshold matches");
      return [];
    }
    const duplicates = [];
    const t0 = performance.now();
    for (const [type, typedUnits] of this.groupByType(units)) {
      const threshold = this.getThreshold(type, thresholds);
      log9("Comparing %d %s units (threshold=%.3f)", typedUnits.length, type, threshold);
      for (let i = 0; i < typedUnits.length; i++) {
        for (let j = i + 1; j < typedUnits.length; j++) {
          const left = typedUnits[i];
          const right = typedUnits[j];
          if (this.shouldSkipComparison(left, right)) continue;
          if (dirtySet && !dirtySet.has(left.filePath) && !dirtySet.has(right.filePath)) {
            continue;
          }
          const hasEmbeddings = left.embedding?.length && right.embedding?.length;
          const similarity = hasEmbeddings ? this.computeWeightedSimilarity(left, right, threshold) : 0;
          if (similarity < threshold) continue;
          const exclusionString = this.deps.pairing.pairKeyForUnits(left, right);
          if (!exclusionString) continue;
          duplicates.push({
            id: `${left.id}::${right.id}`,
            similarity,
            shortId: shortUuid.generate(),
            exclusionString,
            left: this.toMember(left),
            right: this.toMember(right)
          });
        }
      }
    }
    log9("computeDuplicates: %d duplicates in %dms", duplicates.length, (performance.now() - t0).toFixed(2));
    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }
  reuseCleanPairsFromPreviousReport(report, units, dirtySet) {
    const unitIds = new Set(units.map((u) => u.id));
    const reusable = report.duplicates.filter((group) => {
      const leftDirty = dirtySet.has(group.left.filePath);
      const rightDirty = dirtySet.has(group.right.filePath);
      if (leftDirty || rightDirty) return false;
      return unitIds.has(group.left.id) && unitIds.has(group.right.id);
    });
    log9("Reused %d clean-clean duplicate groups from previous report", reusable.length);
    return reusable;
  }
  mergeDuplicates(reused, recomputed) {
    const merged = /* @__PURE__ */ new Map();
    for (const group of reused) {
      merged.set(this.groupKey(group), group);
    }
    for (const group of recomputed) {
      merged.set(this.groupKey(group), group);
    }
    return Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity);
  }
  groupKey(group) {
    return [group.left.id, group.right.id].sort().join("::");
  }
  isGroupExcluded(group) {
    const config = this.config;
    if (!config?.excludedPairs?.length) return false;
    const key = this.deps.pairing.pairKeyForUnits(group.left, group.right);
    if (!key) return false;
    const actual = this.deps.pairing.parsePairKey(key);
    if (!actual) return false;
    return config.excludedPairs.some((entry) => {
      const parsed = this.deps.pairing.parsePairKey(entry);
      return parsed ? this.deps.pairing.pairKeyMatches(actual, parsed) : false;
    });
  }
  getThreshold(type, thresholds) {
    if (type === "class" /* CLASS */) return thresholds.class;
    if (type === "block" /* BLOCK */) return thresholds.block;
    return thresholds.function;
  }
  computeWeightedSimilarity(left, right, threshold) {
    const selfSim = this.similarity(left, right);
    if (left.unitType === "class" /* CLASS */) {
      return selfSim * indexConfig.weights.class.self;
    }
    if (left.unitType === "function" /* FUNCTION */) {
      const w2 = indexConfig.weights.function;
      const hasPC2 = this.bothHaveParent(left, right, "class" /* CLASS */);
      const total2 = w2.self + (hasPC2 ? w2.parentClass : 0);
      if ((w2.self * selfSim + (hasPC2 ? w2.parentClass : 0)) / total2 < threshold) return 0;
      return (w2.self * selfSim + (hasPC2 ? w2.parentClass * this.parentSimilarity(left, right, "class" /* CLASS */) : 0)) / total2;
    }
    const w = indexConfig.weights.block;
    const hasPF = this.bothHaveParent(left, right, "function" /* FUNCTION */);
    const hasPC = this.bothHaveParent(left, right, "class" /* CLASS */);
    const total = w.self + (hasPF ? w.parentFunction : 0) + (hasPC ? w.parentClass : 0);
    if ((w.self * selfSim + (hasPF ? w.parentFunction : 0) + (hasPC ? w.parentClass : 0)) / total < threshold) return 0;
    return (w.self * selfSim + (hasPF ? w.parentFunction * this.parentSimilarity(left, right, "function" /* FUNCTION */) : 0) + (hasPC ? w.parentClass * this.parentSimilarity(left, right, "class" /* CLASS */) : 0)) / total;
  }
  groupByType(units) {
    const byType = /* @__PURE__ */ new Map();
    for (const unit of units) {
      const list = byType.get(unit.unitType) ?? [];
      list.push(unit);
      byType.set(unit.unitType, list);
    }
    return byType;
  }
  toMember(unit) {
    return {
      id: unit.id,
      name: unit.name,
      filePath: unit.filePath,
      startLine: unit.startLine,
      endLine: unit.endLine,
      code: unit.code,
      unitType: unit.unitType
    };
  }
  bothHaveParent(left, right, type) {
    return !!this.findParent(left, type) && !!this.findParent(right, type);
  }
  parentSimilarity(left, right, type) {
    const lp = this.findParent(left, type);
    const rp = this.findParent(right, type);
    if (!lp || !rp) return 0;
    return this.similarity(lp, rp);
  }
  similarity(left, right) {
    if (left.embedding?.length && right.embedding?.length) {
      const sim = this.duplicationCache.getEmbSim(left.id, right.id);
      if (typeof sim === "number") return sim;
      throw new Error(
        `Embedding similarity matrix missing for unit pair ${left.id} / ${right.id}. Ensure DuplicationCache.buildEmbSimCache(...) ran before comparisons and included both units.`
      );
    }
    return this.childSimilarity(left, right);
  }
  childSimilarity(left, right) {
    const lc = left.children ?? [];
    const rc = right.children ?? [];
    if (!lc.length || !rc.length) return 0;
    let best = 0;
    for (const l of lc) {
      for (const r of rc) {
        if (l.unitType !== r.unitType) continue;
        const sim = this.similarity(l, r);
        if (sim > best) best = sim;
      }
    }
    return best;
  }
  shouldSkipComparison(left, right) {
    if (left.unitType !== "block" /* BLOCK */ || right.unitType !== "block" /* BLOCK */) return false;
    if (left.filePath !== right.filePath) return false;
    return left.startLine <= right.startLine && left.endLine >= right.endLine || right.startLine <= left.startLine && right.endLine >= left.endLine;
  }
  findParent(unit, type) {
    let p = unit.parent;
    while (p) {
      if (p.unitType === type) return p;
      p = p.parent;
    }
    return null;
  }
  computeDuplicationScore(duplicates, allUnits) {
    const totalLines = allUnits.reduce((sum, u) => sum + u.endLine - u.startLine + 1, 0);
    if (!totalLines || !duplicates.length) {
      return { score: 0, grade: "Excellent", totalLines, duplicateLines: 0, duplicateGroups: 0 };
    }
    const duplicateLines = duplicates.reduce((sum, g) => {
      const avg = (g.left.endLine - g.left.startLine + 1 + (g.right.endLine - g.right.startLine + 1)) / 2;
      return sum + g.similarity * avg;
    }, 0);
    const score = duplicateLines / totalLines * 100;
    return {
      score,
      grade: this.getScoreGrade(score),
      totalLines,
      duplicateLines: Math.round(duplicateLines),
      duplicateGroups: duplicates.length
    };
  }
  getScoreGrade(score) {
    if (score < 5) return "Excellent";
    if (score < 15) return "Good";
    if (score < 30) return "Fair";
    if (score < 50) return "Poor";
    return "Critical";
  }
  countUnitsByType(units) {
    let classes = 0, functions = 0, blocks = 0;
    for (const u of units) {
      if (u.unitType === "class" /* CLASS */) classes++;
      else if (u.unitType === "function" /* FUNCTION */) functions++;
      else if (u.unitType === "block" /* BLOCK */) blocks++;
    }
    return { classes, functions, blocks, total: units.length };
  }
};

// src/DryScan.ts
var DryScan = class {
  repoPath;
  extractor;
  db;
  services;
  serviceDeps;
  constructor(repoPath, extractor, db) {
    this.repoPath = repoPath;
    this.extractor = extractor ?? new IndexUnitExtractor(repoPath, defaultExtractors(repoPath));
    this.db = db ?? new DryScanDatabase();
    this.serviceDeps = {
      repoPath: this.repoPath,
      db: this.db,
      extractor: this.extractor,
      pairing: new PairingService(this.extractor)
    };
    const exclusion = new ExclusionService(this.serviceDeps);
    this.services = {
      initializer: new RepositoryInitializer(this.serviceDeps, exclusion),
      updater: new UpdateService(this.serviceDeps, exclusion),
      duplicate: new DuplicateService(this.serviceDeps),
      exclusion
    };
  }
  /**
   * Initializes the DryScan repository with a 3-phase analysis:
   * Phase 1: Extract and save all functions
   * Phase 2: Resolve and save internal dependencies
   * Phase 3: Compute and save semantic embeddings
   */
  async init(options) {
    console.log(`[DryScan] Initializing repository at ${this.repoPath}`);
    const dryDir = upath6.join(this.repoPath, DRYSCAN_DIR);
    if (existsSync(dryDir)) {
      console.warn(`[DryScan] Warning: a '.dry' folder already exists at ${dryDir}.`);
    }
    console.log("[DryScan] Preparing database and cache...");
    await configStore.init(this.repoPath);
    await this.ensureDatabase();
    console.log("[DryScan] Starting initial scan (may take a moment)...");
    await this.services.initializer.init(options);
    console.log("[DryScan] Initial scan complete.");
  }
  /**
   * Updates the index by detecting changed, new, and deleted files.
   * Only reprocesses units in changed files for efficiency.
   * Delegates to DryScanUpdater module for implementation.
   * 
   * Update process:
   * 1. List all current source files in repository
   * 2. For each file, check if it's new, changed, or unchanged (via mtime + checksum)
   * 3. Remove old units from changed/deleted files
   * 4. Extract and save units from new/changed files
   * 5. Recompute internal dependencies for affected units
   * 6. Recompute embeddings for affected units
   * 7. Update file tracking metadata
   */
  async updateIndex() {
    console.log(`[DryScan] Updating index at ${this.repoPath}...`);
    console.log("[DryScan] Checking for file changes...");
    const start = Date.now();
    await this.ensureDatabase();
    const dirtyPaths = await this.services.updater.updateIndex();
    const duration = Date.now() - start;
    console.log(`[DryScan] Index update complete. Took ${duration}ms.`);
    return dirtyPaths;
  }
  /**
   * Runs duplicate detection and returns a normalized report payload ready for persistence or display.
   */
  async buildDuplicateReport() {
    const config = await this.loadConfig();
    const { analysis, timings } = await this.findDuplicates(config);
    const m = analysis.metrics;
    const metrics = m ? {
      filesScanned: m.unitCounts.total > 0 ? (await this.extractor.listSourceFiles(this.repoPath)).length : 0,
      totalLinesOfCode: analysis.score.totalLines,
      unitCounts: m.unitCounts,
      pairsBeforeLLM: m.pairsBeforeLLM,
      pairsAfterLLM: m.pairsAfterLLM,
      timings: {
        indexUpdateMs: timings.indexUpdateMs,
        duplicateDetectionMs: timings.dupDetectionMs - m.llmFilterMs,
        llmFilterMs: m.llmFilterMs,
        totalMs: timings.totalMs
      }
    } : void 0;
    const report = {
      version: 1,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      threshold: config.threshold,
      grade: analysis.score.grade,
      score: analysis.score,
      duplicates: analysis.duplicates,
      ...metrics && { metrics }
    };
    await this.saveReport(report);
    return report;
  }
  /**
   * Finds duplicate code blocks using cosine similarity on embeddings.
   * Automatically updates the index before searching to ensure results are current.
   * Compares all function pairs and returns groups with similarity above the configured threshold.
   *
   * @returns Analysis result with duplicate groups and duplication score
   */
  async findDuplicates(config) {
    const totalStart = Date.now();
    console.log(`[DryScan] Finding duplicates (threshold: ${config.threshold})...`);
    await this.ensureDatabase();
    console.log("[DryScan] Updating index...");
    const updateStart = Date.now();
    const dirtyPaths = await this.updateIndex();
    const indexUpdateMs = Date.now() - updateStart;
    console.log(`[DryScan] Index update  took ${indexUpdateMs}ms.`);
    const previousReport = await this.loadLatestReport();
    if (previousReport?.threshold === config.threshold) {
      console.log("[DryScan] Reusing clean-clean duplicates from latest report (threshold unchanged).");
    }
    console.log("[DryScan] Detecting duplicates...");
    const dupStart = Date.now();
    const analysis = await this.services.duplicate.findDuplicates(config, dirtyPaths, previousReport);
    const dupDetectionMs = Date.now() - dupStart;
    console.log(`[DryScan] Duplicate detection took ${dupDetectionMs}ms.`);
    const totalMs = Date.now() - totalStart;
    return { analysis, timings: { indexUpdateMs, dupDetectionMs, totalMs } };
  }
  /**
   * Cleans excludedPairs entries that no longer match any indexed units.
   * Runs an update first to ensure the index reflects current code.
   */
  async cleanExclusions() {
    await this.updateIndex();
    return this.services.exclusion.cleanExclusions();
  }
  async ensureDatabase() {
    if (this.db.isInitialized()) return;
    const dbPath = upath6.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    await fs8.mkdir(upath6.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);
  }
  async loadConfig() {
    return configStore.get(this.repoPath);
  }
  async saveReport(report) {
    const reportDir = upath6.join(this.repoPath, DRYSCAN_DIR, REPORTS_DIR);
    await fs8.mkdir(reportDir, { recursive: true });
    const safeTimestamp = report.generatedAt.replace(/[:.]/g, "-");
    const reportPath = upath6.join(reportDir, `dupes-${safeTimestamp}.json`);
    await fs8.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  async loadLatestReport() {
    const reportDir = upath6.join(this.repoPath, DRYSCAN_DIR, REPORTS_DIR);
    let entries;
    try {
      entries = await fs8.readdir(reportDir);
    } catch (err) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
    const jsonReports = entries.filter((name) => name.endsWith(".json"));
    if (jsonReports.length === 0) return null;
    const withStats = await Promise.all(
      jsonReports.map(async (name) => {
        const fullPath = upath6.join(reportDir, name);
        const stat = await fs8.stat(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = withStats[0];
    const raw = await fs8.readFile(latest.fullPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.duplicates) || typeof parsed.threshold !== "number") {
      return null;
    }
    return parsed;
  }
};
export {
  DryScan,
  configStore
};
//# sourceMappingURL=index.js.map