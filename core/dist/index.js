var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// src/DryScan.ts
import upath6 from "upath";
import fs7 from "fs/promises";

// src/const.ts
var DRYSCAN_DIR = ".dry";
var INDEX_DB = "index.db";
var FILE_CHECKSUM_ALGO = "md5";
var BLOCK_HASH_ALGO = "sha1";

// src/IndexUnitExtractor.ts
import path2 from "path";
import fs3 from "fs/promises";
import upath4 from "upath";
import crypto2 from "crypto";
import debug from "debug";
import { glob as glob2 } from "glob-gitignore";

// src/extractors/java.ts
import crypto from "crypto";
import Parser from "tree-sitter";
import Java from "tree-sitter-java";

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
  threshold: 0.88,
  embeddingSource: "huggingface",
  contextLength: 2048
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
    contextLength: { type: "number" }
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
    "contextLength"
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
    const tree = this.parser.parse(source);
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
        const classId = this.buildId("class" /* CLASS */, className, startLine, endLine);
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
        const skipFunction = this.shouldSkip("function" /* FUNCTION */, fnUnit.name, fnLength);
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
    return units;
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
  shouldSkip(unitType, name, lineCount) {
    if (!this.config) {
      throw new Error("Config not loaded before skip evaluation");
    }
    const config = this.config;
    const minLines = unitType === "block" /* BLOCK */ ? Math.max(indexConfig.blockMinLines, config.minBlockLines ?? 0) : config.minLines;
    const belowMin = minLines > 0 && lineCount < minLines;
    const trivial = unitType === "function" /* FUNCTION */ && this.isTrivialFunction(name);
    return belowMin || trivial;
  }
  isTrivialFunction(fullName) {
    const simpleName = fullName.split(".").pop() || fullName;
    const isGetter = /^(get|is)[A-Z]/.test(simpleName);
    const isSetter = /^set[A-Z]/.test(simpleName);
    return isGetter || isSetter;
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
        if (!this.isTrivialFunction(fullName)) {
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
    const id = this.buildId("function" /* FUNCTION */, name, startLine, endLine);
    const unit = {
      id,
      name,
      filePath: file,
      startLine,
      endLine,
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
          const id = this.buildId("block" /* BLOCK */, parentFunction.name, startLine, endLine);
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
          parentFunction.children = parentFunction.children || [];
          parentFunction.children.push(blockUnit);
          blocks.push(blockUnit);
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
  buildId(type, name, startLine, endLine) {
    return `${type}:${name}:${startLine}-${endLine}`;
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
var log = debug("DryScan:Extractor");
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
    log("Initialized extractor for %s", this.root);
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
      log("Scanning directory %s", fullPath);
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
      log("Skipping excluded file %s", rel);
      return [];
    }
    const source = await fs3.readFile(filePath, "utf8");
    const units = await extractor.extractFromText(rel, source);
    log("Extracted %d units from %s", units.length, rel);
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
    log("Listing source files under %s", fullPath);
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

// src/db/DryScanDatabase.ts
var DryScanDatabase = class {
  dataSource;
  unitRepository;
  fileRepository;
  isInitialized() {
    return !!this.dataSource?.isInitialized;
  }
  async init(dbPath) {
    await fs4.mkdir(upath5.dirname(dbPath), { recursive: true });
    this.dataSource = new DataSource({
      type: "sqlite",
      database: dbPath,
      entities: [IndexUnitEntity, FileEntity],
      synchronize: true,
      logging: false
    });
    await this.dataSource.initialize();
    this.unitRepository = this.dataSource.getRepository(IndexUnitEntity);
    this.fileRepository = this.dataSource.getRepository(FileEntity);
  }
  async saveUnit(unit) {
    await this.saveUnits(unit);
  }
  async saveUnits(units) {
    if (!this.unitRepository) throw new Error("Database not initialized");
    const payload = Array.isArray(units) ? units : [units];
    await this.unitRepository.save(payload);
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
  async close() {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }
};

// src/services/RepositoryInitializer.ts
import path3 from "path";
import fs5 from "fs/promises";

// src/services/EmbeddingService.ts
import debug2 from "debug";

// ../node_modules/@langchain/ollama/dist/utils.js
import { AIMessageChunk } from "@langchain/core/messages";

// ../node_modules/@langchain/ollama/dist/chat_models.js
import { AIMessage, AIMessageChunk as AIMessageChunk2 } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

// ../node_modules/whatwg-fetch/fetch.js
var g = typeof globalThis !== "undefined" && globalThis || typeof self !== "undefined" && self || // eslint-disable-next-line no-undef
typeof global !== "undefined" && global || {};
var support = {
  searchParams: "URLSearchParams" in g,
  iterable: "Symbol" in g && "iterator" in Symbol,
  blob: "FileReader" in g && "Blob" in g && (function() {
    try {
      new Blob();
      return true;
    } catch (e) {
      return false;
    }
  })(),
  formData: "FormData" in g,
  arrayBuffer: "ArrayBuffer" in g
};
function isDataView(obj) {
  return obj && DataView.prototype.isPrototypeOf(obj);
}
if (support.arrayBuffer) {
  viewClasses = [
    "[object Int8Array]",
    "[object Uint8Array]",
    "[object Uint8ClampedArray]",
    "[object Int16Array]",
    "[object Uint16Array]",
    "[object Int32Array]",
    "[object Uint32Array]",
    "[object Float32Array]",
    "[object Float64Array]"
  ];
  isArrayBufferView = ArrayBuffer.isView || function(obj) {
    return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1;
  };
}
var viewClasses;
var isArrayBufferView;
function normalizeName(name) {
  if (typeof name !== "string") {
    name = String(name);
  }
  if (/[^a-z0-9\-#$%&'*+.^_`|~!]/i.test(name) || name === "") {
    throw new TypeError('Invalid character in header field name: "' + name + '"');
  }
  return name.toLowerCase();
}
function normalizeValue(value) {
  if (typeof value !== "string") {
    value = String(value);
  }
  return value;
}
function iteratorFor(items) {
  var iterator = {
    next: function() {
      var value = items.shift();
      return { done: value === void 0, value };
    }
  };
  if (support.iterable) {
    iterator[Symbol.iterator] = function() {
      return iterator;
    };
  }
  return iterator;
}
function Headers2(headers) {
  this.map = {};
  if (headers instanceof Headers2) {
    headers.forEach(function(value, name) {
      this.append(name, value);
    }, this);
  } else if (Array.isArray(headers)) {
    headers.forEach(function(header) {
      if (header.length != 2) {
        throw new TypeError("Headers constructor: expected name/value pair to be length 2, found" + header.length);
      }
      this.append(header[0], header[1]);
    }, this);
  } else if (headers) {
    Object.getOwnPropertyNames(headers).forEach(function(name) {
      this.append(name, headers[name]);
    }, this);
  }
}
Headers2.prototype.append = function(name, value) {
  name = normalizeName(name);
  value = normalizeValue(value);
  var oldValue = this.map[name];
  this.map[name] = oldValue ? oldValue + ", " + value : value;
};
Headers2.prototype["delete"] = function(name) {
  delete this.map[normalizeName(name)];
};
Headers2.prototype.get = function(name) {
  name = normalizeName(name);
  return this.has(name) ? this.map[name] : null;
};
Headers2.prototype.has = function(name) {
  return this.map.hasOwnProperty(normalizeName(name));
};
Headers2.prototype.set = function(name, value) {
  this.map[normalizeName(name)] = normalizeValue(value);
};
Headers2.prototype.forEach = function(callback, thisArg) {
  for (var name in this.map) {
    if (this.map.hasOwnProperty(name)) {
      callback.call(thisArg, this.map[name], name, this);
    }
  }
};
Headers2.prototype.keys = function() {
  var items = [];
  this.forEach(function(value, name) {
    items.push(name);
  });
  return iteratorFor(items);
};
Headers2.prototype.values = function() {
  var items = [];
  this.forEach(function(value) {
    items.push(value);
  });
  return iteratorFor(items);
};
Headers2.prototype.entries = function() {
  var items = [];
  this.forEach(function(value, name) {
    items.push([name, value]);
  });
  return iteratorFor(items);
};
if (support.iterable) {
  Headers2.prototype[Symbol.iterator] = Headers2.prototype.entries;
}
function consumed(body) {
  if (body._noBody) return;
  if (body.bodyUsed) {
    return Promise.reject(new TypeError("Already read"));
  }
  body.bodyUsed = true;
}
function fileReaderReady(reader) {
  return new Promise(function(resolve, reject) {
    reader.onload = function() {
      resolve(reader.result);
    };
    reader.onerror = function() {
      reject(reader.error);
    };
  });
}
function readBlobAsArrayBuffer(blob) {
  var reader = new FileReader();
  var promise = fileReaderReady(reader);
  reader.readAsArrayBuffer(blob);
  return promise;
}
function readBlobAsText(blob) {
  var reader = new FileReader();
  var promise = fileReaderReady(reader);
  var match = /charset=([A-Za-z0-9_-]+)/.exec(blob.type);
  var encoding = match ? match[1] : "utf-8";
  reader.readAsText(blob, encoding);
  return promise;
}
function readArrayBufferAsText(buf) {
  var view = new Uint8Array(buf);
  var chars = new Array(view.length);
  for (var i = 0; i < view.length; i++) {
    chars[i] = String.fromCharCode(view[i]);
  }
  return chars.join("");
}
function bufferClone(buf) {
  if (buf.slice) {
    return buf.slice(0);
  } else {
    var view = new Uint8Array(buf.byteLength);
    view.set(new Uint8Array(buf));
    return view.buffer;
  }
}
function Body() {
  this.bodyUsed = false;
  this._initBody = function(body) {
    this.bodyUsed = this.bodyUsed;
    this._bodyInit = body;
    if (!body) {
      this._noBody = true;
      this._bodyText = "";
    } else if (typeof body === "string") {
      this._bodyText = body;
    } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
      this._bodyBlob = body;
    } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
      this._bodyFormData = body;
    } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
      this._bodyText = body.toString();
    } else if (support.arrayBuffer && support.blob && isDataView(body)) {
      this._bodyArrayBuffer = bufferClone(body.buffer);
      this._bodyInit = new Blob([this._bodyArrayBuffer]);
    } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
      this._bodyArrayBuffer = bufferClone(body);
    } else {
      this._bodyText = body = Object.prototype.toString.call(body);
    }
    if (!this.headers.get("content-type")) {
      if (typeof body === "string") {
        this.headers.set("content-type", "text/plain;charset=UTF-8");
      } else if (this._bodyBlob && this._bodyBlob.type) {
        this.headers.set("content-type", this._bodyBlob.type);
      } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
        this.headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
      }
    }
  };
  if (support.blob) {
    this.blob = function() {
      var rejected = consumed(this);
      if (rejected) {
        return rejected;
      }
      if (this._bodyBlob) {
        return Promise.resolve(this._bodyBlob);
      } else if (this._bodyArrayBuffer) {
        return Promise.resolve(new Blob([this._bodyArrayBuffer]));
      } else if (this._bodyFormData) {
        throw new Error("could not read FormData body as blob");
      } else {
        return Promise.resolve(new Blob([this._bodyText]));
      }
    };
  }
  this.arrayBuffer = function() {
    if (this._bodyArrayBuffer) {
      var isConsumed = consumed(this);
      if (isConsumed) {
        return isConsumed;
      } else if (ArrayBuffer.isView(this._bodyArrayBuffer)) {
        return Promise.resolve(
          this._bodyArrayBuffer.buffer.slice(
            this._bodyArrayBuffer.byteOffset,
            this._bodyArrayBuffer.byteOffset + this._bodyArrayBuffer.byteLength
          )
        );
      } else {
        return Promise.resolve(this._bodyArrayBuffer);
      }
    } else if (support.blob) {
      return this.blob().then(readBlobAsArrayBuffer);
    } else {
      throw new Error("could not read as ArrayBuffer");
    }
  };
  this.text = function() {
    var rejected = consumed(this);
    if (rejected) {
      return rejected;
    }
    if (this._bodyBlob) {
      return readBlobAsText(this._bodyBlob);
    } else if (this._bodyArrayBuffer) {
      return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer));
    } else if (this._bodyFormData) {
      throw new Error("could not read FormData body as text");
    } else {
      return Promise.resolve(this._bodyText);
    }
  };
  if (support.formData) {
    this.formData = function() {
      return this.text().then(decode);
    };
  }
  this.json = function() {
    return this.text().then(JSON.parse);
  };
  return this;
}
var methods = ["CONNECT", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"];
function normalizeMethod(method) {
  var upcased = method.toUpperCase();
  return methods.indexOf(upcased) > -1 ? upcased : method;
}
function Request(input, options) {
  if (!(this instanceof Request)) {
    throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.');
  }
  options = options || {};
  var body = options.body;
  if (input instanceof Request) {
    if (input.bodyUsed) {
      throw new TypeError("Already read");
    }
    this.url = input.url;
    this.credentials = input.credentials;
    if (!options.headers) {
      this.headers = new Headers2(input.headers);
    }
    this.method = input.method;
    this.mode = input.mode;
    this.signal = input.signal;
    if (!body && input._bodyInit != null) {
      body = input._bodyInit;
      input.bodyUsed = true;
    }
  } else {
    this.url = String(input);
  }
  this.credentials = options.credentials || this.credentials || "same-origin";
  if (options.headers || !this.headers) {
    this.headers = new Headers2(options.headers);
  }
  this.method = normalizeMethod(options.method || this.method || "GET");
  this.mode = options.mode || this.mode || null;
  this.signal = options.signal || this.signal || (function() {
    if ("AbortController" in g) {
      var ctrl = new AbortController();
      return ctrl.signal;
    }
  })();
  this.referrer = null;
  if ((this.method === "GET" || this.method === "HEAD") && body) {
    throw new TypeError("Body not allowed for GET or HEAD requests");
  }
  this._initBody(body);
  if (this.method === "GET" || this.method === "HEAD") {
    if (options.cache === "no-store" || options.cache === "no-cache") {
      var reParamSearch = /([?&])_=[^&]*/;
      if (reParamSearch.test(this.url)) {
        this.url = this.url.replace(reParamSearch, "$1_=" + (/* @__PURE__ */ new Date()).getTime());
      } else {
        var reQueryString = /\?/;
        this.url += (reQueryString.test(this.url) ? "&" : "?") + "_=" + (/* @__PURE__ */ new Date()).getTime();
      }
    }
  }
}
Request.prototype.clone = function() {
  return new Request(this, { body: this._bodyInit });
};
function decode(body) {
  var form = new FormData();
  body.trim().split("&").forEach(function(bytes) {
    if (bytes) {
      var split = bytes.split("=");
      var name = split.shift().replace(/\+/g, " ");
      var value = split.join("=").replace(/\+/g, " ");
      form.append(decodeURIComponent(name), decodeURIComponent(value));
    }
  });
  return form;
}
function parseHeaders(rawHeaders) {
  var headers = new Headers2();
  var preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, " ");
  preProcessedHeaders.split("\r").map(function(header) {
    return header.indexOf("\n") === 0 ? header.substr(1, header.length) : header;
  }).forEach(function(line) {
    var parts = line.split(":");
    var key = parts.shift().trim();
    if (key) {
      var value = parts.join(":").trim();
      try {
        headers.append(key, value);
      } catch (error) {
        console.warn("Response " + error.message);
      }
    }
  });
  return headers;
}
Body.call(Request.prototype);
function Response(bodyInit, options) {
  if (!(this instanceof Response)) {
    throw new TypeError('Please use the "new" operator, this DOM object constructor cannot be called as a function.');
  }
  if (!options) {
    options = {};
  }
  this.type = "default";
  this.status = options.status === void 0 ? 200 : options.status;
  if (this.status < 200 || this.status > 599) {
    throw new RangeError("Failed to construct 'Response': The status provided (0) is outside the range [200, 599].");
  }
  this.ok = this.status >= 200 && this.status < 300;
  this.statusText = options.statusText === void 0 ? "" : "" + options.statusText;
  this.headers = new Headers2(options.headers);
  this.url = options.url || "";
  this._initBody(bodyInit);
}
Body.call(Response.prototype);
Response.prototype.clone = function() {
  return new Response(this._bodyInit, {
    status: this.status,
    statusText: this.statusText,
    headers: new Headers2(this.headers),
    url: this.url
  });
};
Response.error = function() {
  var response = new Response(null, { status: 200, statusText: "" });
  response.ok = false;
  response.status = 0;
  response.type = "error";
  return response;
};
var redirectStatuses = [301, 302, 303, 307, 308];
Response.redirect = function(url, status) {
  if (redirectStatuses.indexOf(status) === -1) {
    throw new RangeError("Invalid status code");
  }
  return new Response(null, { status, headers: { location: url } });
};
var DOMException = g.DOMException;
try {
  new DOMException();
} catch (err) {
  DOMException = function(message, name) {
    this.message = message;
    this.name = name;
    var error = Error(message);
    this.stack = error.stack;
  };
  DOMException.prototype = Object.create(Error.prototype);
  DOMException.prototype.constructor = DOMException;
}
function fetch2(input, init) {
  return new Promise(function(resolve, reject) {
    var request = new Request(input, init);
    if (request.signal && request.signal.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    var xhr = new XMLHttpRequest();
    function abortXhr() {
      xhr.abort();
    }
    xhr.onload = function() {
      var options = {
        statusText: xhr.statusText,
        headers: parseHeaders(xhr.getAllResponseHeaders() || "")
      };
      if (request.url.indexOf("file://") === 0 && (xhr.status < 200 || xhr.status > 599)) {
        options.status = 200;
      } else {
        options.status = xhr.status;
      }
      options.url = "responseURL" in xhr ? xhr.responseURL : options.headers.get("X-Request-URL");
      var body = "response" in xhr ? xhr.response : xhr.responseText;
      setTimeout(function() {
        resolve(new Response(body, options));
      }, 0);
    };
    xhr.onerror = function() {
      setTimeout(function() {
        reject(new TypeError("Network request failed"));
      }, 0);
    };
    xhr.ontimeout = function() {
      setTimeout(function() {
        reject(new TypeError("Network request timed out"));
      }, 0);
    };
    xhr.onabort = function() {
      setTimeout(function() {
        reject(new DOMException("Aborted", "AbortError"));
      }, 0);
    };
    function fixUrl(url) {
      try {
        return url === "" && g.location.href ? g.location.href : url;
      } catch (e) {
        return url;
      }
    }
    xhr.open(request.method, fixUrl(request.url), true);
    if (request.credentials === "include") {
      xhr.withCredentials = true;
    } else if (request.credentials === "omit") {
      xhr.withCredentials = false;
    }
    if ("responseType" in xhr) {
      if (support.blob) {
        xhr.responseType = "blob";
      } else if (support.arrayBuffer) {
        xhr.responseType = "arraybuffer";
      }
    }
    if (init && typeof init.headers === "object" && !(init.headers instanceof Headers2 || g.Headers && init.headers instanceof g.Headers)) {
      var names = [];
      Object.getOwnPropertyNames(init.headers).forEach(function(name) {
        names.push(normalizeName(name));
        xhr.setRequestHeader(name, normalizeValue(init.headers[name]));
      });
      request.headers.forEach(function(value, name) {
        if (names.indexOf(name) === -1) {
          xhr.setRequestHeader(name, value);
        }
      });
    } else {
      request.headers.forEach(function(value, name) {
        xhr.setRequestHeader(name, value);
      });
    }
    if (request.signal) {
      request.signal.addEventListener("abort", abortXhr);
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          request.signal.removeEventListener("abort", abortXhr);
        }
      };
    }
    xhr.send(typeof request._bodyInit === "undefined" ? null : request._bodyInit);
  });
}
fetch2.polyfill = true;
if (!g.fetch) {
  g.fetch = fetch2;
  g.Headers = Headers2;
  g.Request = Request;
  g.Response = Response;
}

// ../node_modules/ollama/dist/browser.mjs
var defaultPort = "11434";
var defaultHost = `http://127.0.0.1:${defaultPort}`;
var version = "0.6.3";
var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => {
  __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
var ResponseError = class _ResponseError extends Error {
  constructor(error, status_code) {
    super(error);
    this.error = error;
    this.status_code = status_code;
    this.name = "ResponseError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _ResponseError);
    }
  }
};
var AbortableAsyncIterator = class {
  constructor(abortController, itr, doneCallback) {
    __publicField$1(this, "abortController");
    __publicField$1(this, "itr");
    __publicField$1(this, "doneCallback");
    this.abortController = abortController;
    this.itr = itr;
    this.doneCallback = doneCallback;
  }
  abort() {
    this.abortController.abort();
  }
  async *[Symbol.asyncIterator]() {
    for await (const message of this.itr) {
      if ("error" in message) {
        throw new Error(message.error);
      }
      yield message;
      if (message.done || message.status === "success") {
        this.doneCallback();
        return;
      }
    }
    throw new Error("Did not receive done or success response in stream.");
  }
};
var checkOk = async (response) => {
  if (response.ok) {
    return;
  }
  let message = `Error ${response.status}: ${response.statusText}`;
  let errorData = null;
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      errorData = await response.json();
      message = errorData.error || message;
    } catch (error) {
      console.log("Failed to parse error response as JSON");
    }
  } else {
    try {
      console.log("Getting text from response");
      const textResponse = await response.text();
      message = textResponse || message;
    } catch (error) {
      console.log("Failed to get text from error response");
    }
  }
  throw new ResponseError(message, response.status);
};
function getPlatform() {
  if (typeof window !== "undefined" && window.navigator) {
    const nav = navigator;
    if ("userAgentData" in nav && nav.userAgentData?.platform) {
      return `${nav.userAgentData.platform.toLowerCase()} Browser/${navigator.userAgent};`;
    }
    if (navigator.platform) {
      return `${navigator.platform.toLowerCase()} Browser/${navigator.userAgent};`;
    }
    return `unknown Browser/${navigator.userAgent};`;
  } else if (typeof process !== "undefined") {
    return `${process.arch} ${process.platform} Node.js/${process.version}`;
  }
  return "";
}
function normalizeHeaders(headers) {
  if (headers instanceof Headers) {
    const obj = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  } else if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  } else {
    return headers || {};
  }
}
var readEnvVar = (obj, key) => {
  return obj[key];
};
var fetchWithHeaders = async (fetch3, url, options = {}) => {
  const defaultHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": `ollama-js/${version} (${getPlatform()})`
  };
  options.headers = normalizeHeaders(options.headers);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.hostname === "ollama.com") {
      const apiKey = typeof process === "object" && process !== null && typeof process.env === "object" && process.env !== null ? readEnvVar(process.env, "OLLAMA_API_KEY") : void 0;
      const authorization = options.headers["authorization"] || options.headers["Authorization"];
      if (!authorization && apiKey) {
        options.headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }
  } catch (error) {
    console.error("error parsing url", error);
  }
  const customHeaders = Object.fromEntries(
    Object.entries(options.headers).filter(
      ([key]) => !Object.keys(defaultHeaders).some(
        (defaultKey) => defaultKey.toLowerCase() === key.toLowerCase()
      )
    )
  );
  options.headers = {
    ...defaultHeaders,
    ...customHeaders
  };
  return fetch3(url, options);
};
var get = async (fetch3, host, options) => {
  const response = await fetchWithHeaders(fetch3, host, {
    headers: options?.headers
  });
  await checkOk(response);
  return response;
};
var post = async (fetch3, host, data, options) => {
  const isRecord = (input) => {
    return input !== null && typeof input === "object" && !Array.isArray(input);
  };
  const formattedData = isRecord(data) ? JSON.stringify(data) : data;
  const response = await fetchWithHeaders(fetch3, host, {
    method: "POST",
    body: formattedData,
    signal: options?.signal,
    headers: options?.headers
  });
  await checkOk(response);
  return response;
};
var del = async (fetch3, host, data, options) => {
  const response = await fetchWithHeaders(fetch3, host, {
    method: "DELETE",
    body: JSON.stringify(data),
    headers: options?.headers
  });
  await checkOk(response);
  return response;
};
var parseJSON = async function* (itr) {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const reader = itr.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      try {
        yield JSON.parse(part);
      } catch (error) {
        console.warn("invalid json: ", part);
      }
    }
  }
  buffer += decoder.decode();
  for (const part of buffer.split("\n").filter((p) => p !== "")) {
    try {
      yield JSON.parse(part);
    } catch (error) {
      console.warn("invalid json: ", part);
    }
  }
};
var formatHost = (host) => {
  if (!host) {
    return defaultHost;
  }
  let isExplicitProtocol = host.includes("://");
  if (host.startsWith(":")) {
    host = `http://127.0.0.1${host}`;
    isExplicitProtocol = true;
  }
  if (!isExplicitProtocol) {
    host = `http://${host}`;
  }
  const url = new URL(host);
  let port = url.port;
  if (!port) {
    if (!isExplicitProtocol) {
      port = defaultPort;
    } else {
      port = url.protocol === "https:" ? "443" : "80";
    }
  }
  let auth = "";
  if (url.username) {
    auth = url.username;
    if (url.password) {
      auth += `:${url.password}`;
    }
    auth += "@";
  }
  let formattedHost = `${url.protocol}//${auth}${url.hostname}:${port}${url.pathname}`;
  if (formattedHost.endsWith("/")) {
    formattedHost = formattedHost.slice(0, -1);
  }
  return formattedHost;
};
var __defProp2 = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
var Ollama$1 = class Ollama {
  constructor(config) {
    __publicField(this, "config");
    __publicField(this, "fetch");
    __publicField(this, "ongoingStreamedRequests", []);
    this.config = {
      host: "",
      headers: config?.headers
    };
    if (!config?.proxy) {
      this.config.host = formatHost(config?.host ?? defaultHost);
    }
    this.fetch = config?.fetch ?? fetch;
  }
  // Abort any ongoing streamed requests to Ollama
  abort() {
    for (const request of this.ongoingStreamedRequests) {
      request.abort();
    }
    this.ongoingStreamedRequests.length = 0;
  }
  /**
   * Processes a request to the Ollama server. If the request is streamable, it will return a
   * AbortableAsyncIterator that yields the response messages. Otherwise, it will return the response
   * object.
   * @param endpoint {string} - The endpoint to send the request to.
   * @param request {object} - The request object to send to the endpoint.
   * @protected {T | AbortableAsyncIterator<T>} - The response object or a AbortableAsyncIterator that yields
   * response messages.
   * @throws {Error} - If the response body is missing or if the response is an error.
   * @returns {Promise<T | AbortableAsyncIterator<T>>} - The response object or a AbortableAsyncIterator that yields the streamed response.
   */
  async processStreamableRequest(endpoint, request) {
    request.stream = request.stream ?? false;
    const host = `${this.config.host}/api/${endpoint}`;
    if (request.stream) {
      const abortController = new AbortController();
      const response2 = await post(this.fetch, host, request, {
        signal: abortController.signal,
        headers: this.config.headers
      });
      if (!response2.body) {
        throw new Error("Missing body");
      }
      const itr = parseJSON(response2.body);
      const abortableAsyncIterator = new AbortableAsyncIterator(
        abortController,
        itr,
        () => {
          const i = this.ongoingStreamedRequests.indexOf(abortableAsyncIterator);
          if (i > -1) {
            this.ongoingStreamedRequests.splice(i, 1);
          }
        }
      );
      this.ongoingStreamedRequests.push(abortableAsyncIterator);
      return abortableAsyncIterator;
    }
    const response = await post(this.fetch, host, request, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Encodes an image to base64 if it is a Uint8Array.
   * @param image {Uint8Array | string} - The image to encode.
   * @returns {Promise<string>} - The base64 encoded image.
   */
  async encodeImage(image) {
    if (typeof image !== "string") {
      const uint8Array = new Uint8Array(image);
      let byteString = "";
      const len = uint8Array.byteLength;
      for (let i = 0; i < len; i++) {
        byteString += String.fromCharCode(uint8Array[i]);
      }
      return btoa(byteString);
    }
    return image;
  }
  /**
   * Generates a response from a text prompt.
   * @param request {GenerateRequest} - The request object.
   * @returns {Promise<GenerateResponse | AbortableAsyncIterator<GenerateResponse>>} - The response object or
   * an AbortableAsyncIterator that yields response messages.
   */
  async generate(request) {
    if (request.images) {
      request.images = await Promise.all(request.images.map(this.encodeImage.bind(this)));
    }
    return this.processStreamableRequest("generate", request);
  }
  /**
   * Chats with the model. The request object can contain messages with images that are either
   * Uint8Arrays or base64 encoded strings. The images will be base64 encoded before sending the
   * request.
   * @param request {ChatRequest} - The request object.
   * @returns {Promise<ChatResponse | AbortableAsyncIterator<ChatResponse>>} - The response object or an
   * AbortableAsyncIterator that yields response messages.
   */
  async chat(request) {
    if (request.messages) {
      for (const message of request.messages) {
        if (message.images) {
          message.images = await Promise.all(
            message.images.map(this.encodeImage.bind(this))
          );
        }
      }
    }
    return this.processStreamableRequest("chat", request);
  }
  /**
   * Creates a new model from a stream of data.
   * @param request {CreateRequest} - The request object.
   * @returns {Promise<ProgressResponse | AbortableAsyncIterator<ProgressResponse>>} - The response object or a stream of progress responses.
   */
  async create(request) {
    return this.processStreamableRequest("create", {
      ...request
    });
  }
  /**
   * Pulls a model from the Ollama registry. The request object can contain a stream flag to indicate if the
   * response should be streamed.
   * @param request {PullRequest} - The request object.
   * @returns {Promise<ProgressResponse | AbortableAsyncIterator<ProgressResponse>>} - The response object or
   * an AbortableAsyncIterator that yields response messages.
   */
  async pull(request) {
    return this.processStreamableRequest("pull", {
      name: request.model,
      stream: request.stream,
      insecure: request.insecure
    });
  }
  /**
   * Pushes a model to the Ollama registry. The request object can contain a stream flag to indicate if the
   * response should be streamed.
   * @param request {PushRequest} - The request object.
   * @returns {Promise<ProgressResponse | AbortableAsyncIterator<ProgressResponse>>} - The response object or
   * an AbortableAsyncIterator that yields response messages.
   */
  async push(request) {
    return this.processStreamableRequest("push", {
      name: request.model,
      stream: request.stream,
      insecure: request.insecure
    });
  }
  /**
   * Deletes a model from the server. The request object should contain the name of the model to
   * delete.
   * @param request {DeleteRequest} - The request object.
   * @returns {Promise<StatusResponse>} - The response object.
   */
  async delete(request) {
    await del(
      this.fetch,
      `${this.config.host}/api/delete`,
      { name: request.model },
      { headers: this.config.headers }
    );
    return { status: "success" };
  }
  /**
   * Copies a model from one name to another. The request object should contain the name of the
   * model to copy and the new name.
   * @param request {CopyRequest} - The request object.
   * @returns {Promise<StatusResponse>} - The response object.
   */
  async copy(request) {
    await post(this.fetch, `${this.config.host}/api/copy`, { ...request }, {
      headers: this.config.headers
    });
    return { status: "success" };
  }
  /**
   * Lists the models on the server.
   * @returns {Promise<ListResponse>} - The response object.
   * @throws {Error} - If the response body is missing.
   */
  async list() {
    const response = await get(this.fetch, `${this.config.host}/api/tags`, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Shows the metadata of a model. The request object should contain the name of the model.
   * @param request {ShowRequest} - The request object.
   * @returns {Promise<ShowResponse>} - The response object.
   */
  async show(request) {
    const response = await post(this.fetch, `${this.config.host}/api/show`, {
      ...request
    }, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Embeds text input into vectors.
   * @param request {EmbedRequest} - The request object.
   * @returns {Promise<EmbedResponse>} - The response object.
   */
  async embed(request) {
    const response = await post(this.fetch, `${this.config.host}/api/embed`, {
      ...request
    }, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Embeds a text prompt into a vector.
   * @param request {EmbeddingsRequest} - The request object.
   * @returns {Promise<EmbeddingsResponse>} - The response object.
   */
  async embeddings(request) {
    const response = await post(this.fetch, `${this.config.host}/api/embeddings`, {
      ...request
    }, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Lists the running models on the server
   * @returns {Promise<ListResponse>} - The response object.
   * @throws {Error} - If the response body is missing.
   */
  async ps() {
    const response = await get(this.fetch, `${this.config.host}/api/ps`, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Returns the Ollama server version.
   * @returns {Promise<VersionResponse>} - The server version object.
   */
  async version() {
    const response = await get(this.fetch, `${this.config.host}/api/version`, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Performs web search using the Ollama web search API
   * @param request {WebSearchRequest} - The search request containing query and options
   * @returns {Promise<WebSearchResponse>} - The search results
   * @throws {Error} - If the request is invalid or the server returns an error
   */
  async webSearch(request) {
    if (!request.query || request.query.length === 0) {
      throw new Error("Query is required");
    }
    const response = await post(this.fetch, `https://ollama.com/api/web_search`, { ...request }, {
      headers: this.config.headers
    });
    return await response.json();
  }
  /**
   * Fetches a single page using the Ollama web fetch API
   * @param request {WebFetchRequest} - The fetch request containing a URL
   * @returns {Promise<WebFetchResponse>} - The fetch result
   * @throws {Error} - If the request is invalid or the server returns an error
   */
  async webFetch(request) {
    if (!request.url || request.url.length === 0) {
      throw new Error("URL is required");
    }
    const response = await post(this.fetch, `https://ollama.com/api/web_fetch`, { ...request }, { headers: this.config.headers });
    return await response.json();
  }
};
var browser = new Ollama$1();

// ../node_modules/@langchain/ollama/dist/chat_models.js
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { concat } from "@langchain/core/utils/stream";
import { JsonOutputParser, StructuredOutputParser } from "@langchain/core/output_parsers";
import { JsonOutputKeyToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { getEnvironmentVariable } from "@langchain/core/utils/env";
import { isInteropZodSchema } from "@langchain/core/utils/types";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

// ../node_modules/@langchain/ollama/dist/embeddings.js
import { getEnvironmentVariable as getEnvironmentVariable2 } from "@langchain/core/utils/env";
import { Embeddings } from "@langchain/core/embeddings";
var OllamaEmbeddings = class extends Embeddings {
  model = "mxbai-embed-large";
  baseUrl = "http://localhost:11434";
  dimensions;
  keepAlive;
  requestOptions;
  client;
  truncate = false;
  constructor(fields) {
    super({
      maxConcurrency: 1,
      ...fields
    });
    this.baseUrl = fields?.baseUrl ?? getEnvironmentVariable2("OLLAMA_BASE_URL") ?? this.baseUrl;
    this.client = new Ollama$1({
      fetch: fields?.fetch,
      host: this.baseUrl,
      headers: fields?.headers ? new Headers(fields.headers) : void 0
    });
    this.model = fields?.model ?? this.model;
    this.dimensions = fields?.dimensions;
    this.keepAlive = fields?.keepAlive;
    this.truncate = fields?.truncate ?? this.truncate;
    this.requestOptions = fields?.requestOptions ? this._convertOptions(fields?.requestOptions) : void 0;
  }
  /** convert camelCased Ollama request options like "useMMap" to
  * the snake_cased equivalent which the ollama API actually uses.
  * Used only for consistency with the llms/Ollama and chatModels/Ollama classes
  */
  _convertOptions(requestOptions) {
    const snakeCasedOptions = {};
    const mapping = {
      embeddingOnly: "embedding_only",
      frequencyPenalty: "frequency_penalty",
      keepAlive: "keep_alive",
      logitsAll: "logits_all",
      lowVram: "low_vram",
      mainGpu: "main_gpu",
      mirostat: "mirostat",
      mirostatEta: "mirostat_eta",
      mirostatTau: "mirostat_tau",
      numBatch: "num_batch",
      numCtx: "num_ctx",
      numGpu: "num_gpu",
      numKeep: "num_keep",
      numPredict: "num_predict",
      numThread: "num_thread",
      penalizeNewline: "penalize_newline",
      presencePenalty: "presence_penalty",
      repeatLastN: "repeat_last_n",
      repeatPenalty: "repeat_penalty",
      temperature: "temperature",
      stop: "stop",
      tfsZ: "tfs_z",
      topK: "top_k",
      topP: "top_p",
      typicalP: "typical_p",
      useMlock: "use_mlock",
      useMmap: "use_mmap",
      vocabOnly: "vocab_only",
      f16Kv: "f16_kv",
      numa: "numa",
      seed: "seed"
    };
    for (const [key, value] of Object.entries(requestOptions)) {
      const snakeCasedOption = mapping[key];
      if (snakeCasedOption) snakeCasedOptions[snakeCasedOption] = value;
      else snakeCasedOptions[key] = value;
    }
    return snakeCasedOptions;
  }
  async embedDocuments(texts) {
    return this.embeddingWithRetry(texts);
  }
  async embedQuery(text) {
    return (await this.embeddingWithRetry([text]))[0];
  }
  async embeddingWithRetry(texts) {
    const res = await this.caller.call(() => this.client.embed({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
      keep_alive: this.keepAlive,
      options: this.requestOptions,
      truncate: this.truncate
    }));
    return res.embeddings;
  }
};

// ../node_modules/@langchain/ollama/dist/llms.js
import { GenerationChunk } from "@langchain/core/outputs";
import { getEnvironmentVariable as getEnvironmentVariable3 } from "@langchain/core/utils/env";
import { LLM } from "@langchain/core/language_models/llms";

// src/services/EmbeddingService.ts
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
var log2 = debug2("DryScan:EmbeddingService");
var OLLAMA_MODEL = "embeddinggemma";
var HUGGINGFACE_MODEL = "google/embeddinggemma-300m";
var EmbeddingService = class {
  constructor(repoPath) {
    this.repoPath = repoPath;
  }
  /**
   * Generates an embedding for the given index unit using the configured provider.
   * Skips embedding if code exceeds the configured context length.
   */
  async addEmbedding(fn) {
    const config = await configStore.get(this.repoPath);
    const maxContext = config?.contextLength ?? 2048;
    if (fn.code.length > maxContext) {
      log2(
        "Skipping embedding for %s (code length %d exceeds context %d)",
        fn.id,
        fn.code.length,
        maxContext
      );
      return { ...fn, embedding: null };
    }
    const source = config.embeddingSource;
    if (!source) {
      const message = `Embedding source is not configured for repository at ${this.repoPath}`;
      log2(message);
      throw new Error(message);
    }
    const embeddings = this.buildProvider(source);
    const embedding = await embeddings.embedQuery(fn.code);
    return { ...fn, embedding };
  }
  /**
   * Builds the embedding provider based on the source configuration.
   * - URL (http/https): Uses Ollama with "embeddinggemma" model
   * - "huggingface": Uses HuggingFace Inference API with "embeddinggemma-300m" model
   */
  buildProvider(source) {
    if (source.toLowerCase() === "huggingface") {
      log2("Using HuggingFace Inference with model: %s", HUGGINGFACE_MODEL);
      return new HuggingFaceInferenceEmbeddings({
        model: HUGGINGFACE_MODEL
      });
    }
    if (/^https?:\/\//i.test(source)) {
      log2("Using Ollama at %s with model: %s", source, OLLAMA_MODEL);
      return new OllamaEmbeddings({
        model: OLLAMA_MODEL,
        baseUrl: source
      });
    }
    const message = `Unsupported embedding source: ${source || "(empty)"}. Use "huggingface" or an Ollama URL.`;
    log2(message);
    throw new Error(message);
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
    const embeddingService = new EmbeddingService(this.deps.repoPath);
    for (let i = 0; i < total; i++) {
      const unit = allUnits[i];
      try {
        const enriched = await embeddingService.addEmbedding(unit);
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
import debug4 from "debug";

// src/DryScanUpdater.ts
import path4 from "path";
import fs6 from "fs/promises";
import debug3 from "debug";
var log3 = debug3("DryScan:Updater");
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
  log3("Starting incremental update");
  const embeddingService = new EmbeddingService(repoPath);
  const changeSet = await detectFileChanges(repoPath, extractor, db);
  if (changeSet.changed.length === 0 && changeSet.added.length === 0 && changeSet.deleted.length === 0) {
    log3("No changes detected. Index is up to date.");
    return changeSet;
  }
  log3(`Changes detected: ${changeSet.added.length} added, ${changeSet.changed.length} changed, ${changeSet.deleted.length} deleted`);
  const filesToRemove = [...changeSet.changed, ...changeSet.deleted];
  if (filesToRemove.length > 0) {
    await db.removeUnitsByFilePaths(filesToRemove);
    log3(`Removed units from ${filesToRemove.length} files`);
  }
  const filesToProcess = [...changeSet.added, ...changeSet.changed];
  if (filesToProcess.length > 0) {
    const newUnits = await extractUnitsFromFiles(filesToProcess, extractor);
    await db.saveUnits(newUnits);
    log3(`Extracted and saved ${newUnits.length} units from ${filesToProcess.length} files`);
    const total = newUnits.length;
    if (total > 0) {
      log3(`Recomputing embeddings for ${total} units`);
      const progressInterval = Math.max(1, Math.ceil(total / 10));
      const updatedWithEmbeddings = [];
      for (let i = 0; i < total; i++) {
        const unit = newUnits[i];
        try {
          const enriched = await embeddingService.addEmbedding(unit);
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
      log3(`Recomputed embeddings for ${updatedWithEmbeddings.length} units`);
    }
  }
  await updateFileTracking(changeSet, repoPath, extractor, db);
  log3("Incremental update complete");
  return changeSet;
}

// src/services/DuplicationCache.ts
var DuplicationCache = class _DuplicationCache {
  static instance = null;
  comparisons = /* @__PURE__ */ new Map();
  fileIndex = /* @__PURE__ */ new Map();
  initialized = false;
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

// src/services/UpdateService.ts
var log4 = debug4("DryScan:UpdateService");
var UpdateService = class {
  constructor(deps, exclusionService) {
    this.deps = deps;
    this.exclusionService = exclusionService;
  }
  async updateIndex() {
    const extractor = this.deps.extractor;
    const cache = DuplicationCache.getInstance();
    try {
      const changeSet = await performIncrementalUpdate(this.deps.repoPath, extractor, this.deps.db);
      await this.exclusionService.cleanupExcludedFiles();
      await cache.invalidate([...changeSet.changed, ...changeSet.deleted]);
    } catch (err) {
      log4("Error during index update:", err);
      throw err;
    }
  }
};

// src/services/DuplicateService.ts
import debug5 from "debug";
import shortUuid from "short-uuid";
import { cosineSimilarity } from "@langchain/core/utils/math";
var log5 = debug5("DryScan:DuplicateService");
var DuplicateService = class {
  constructor(deps) {
    this.deps = deps;
  }
  config;
  cache = DuplicationCache.getInstance();
  async findDuplicates(config) {
    this.config = config;
    const allUnits = await this.deps.db.getAllUnits();
    if (allUnits.length < 2) {
      const score2 = this.computeDuplicationScore([], allUnits);
      return { duplicates: [], score: score2 };
    }
    const thresholds = this.resolveThresholds(config.threshold);
    const duplicates = this.computeDuplicates(allUnits, thresholds);
    const filteredDuplicates = duplicates.filter((group) => !this.isGroupExcluded(group));
    log5("Found %d duplicate groups", filteredDuplicates.length);
    this.cache.update(filteredDuplicates).catch((err) => log5("Cache update failed: %O", err));
    const score = this.computeDuplicationScore(filteredDuplicates, allUnits);
    return { duplicates: filteredDuplicates, score };
  }
  resolveThresholds(functionThreshold) {
    const defaults = indexConfig.thresholds;
    const clamp = (value) => Math.min(1, Math.max(0, value));
    const base = functionThreshold ?? defaults.function;
    const blockOffset = defaults.block - defaults.function;
    const classOffset = defaults.class - defaults.function;
    const functionThresholdValue = clamp(base);
    return {
      function: functionThresholdValue,
      block: clamp(functionThresholdValue + blockOffset),
      class: clamp(functionThresholdValue + classOffset)
    };
  }
  computeDuplicates(units, thresholds) {
    const duplicates = [];
    const byType = /* @__PURE__ */ new Map();
    for (const unit of units) {
      const list = byType.get(unit.unitType) ?? [];
      list.push(unit);
      byType.set(unit.unitType, list);
    }
    for (const [type, typedUnits] of byType.entries()) {
      const threshold = this.getThreshold(type, thresholds);
      for (let i = 0; i < typedUnits.length; i++) {
        for (let j = i + 1; j < typedUnits.length; j++) {
          const left = typedUnits[i];
          const right = typedUnits[j];
          if (this.shouldSkipComparison(left, right)) continue;
          const cached = this.cache.get(left.id, right.id, left.filePath, right.filePath);
          let similarity = null;
          if (cached !== null) {
            similarity = cached;
          } else {
            if (!left.embedding || !right.embedding) continue;
            similarity = this.computeWeightedSimilarity(left, right);
          }
          if (similarity === null) continue;
          if (similarity >= threshold) {
            const exclusionString = this.deps.pairing.pairKeyForUnits(left, right);
            if (!exclusionString) continue;
            duplicates.push({
              id: `${left.id}::${right.id}`,
              similarity,
              shortId: shortUuid.generate(),
              exclusionString,
              left: {
                id: left.id,
                name: left.name,
                filePath: left.filePath,
                startLine: left.startLine,
                endLine: left.endLine,
                code: left.code,
                unitType: left.unitType
              },
              right: {
                id: right.id,
                name: right.name,
                filePath: right.filePath,
                startLine: right.startLine,
                endLine: right.endLine,
                code: right.code,
                unitType: right.unitType
              }
            });
          }
        }
      }
    }
    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }
  isGroupExcluded(group) {
    const config = this.config;
    if (!config || !config.excludedPairs || config.excludedPairs.length === 0) return false;
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
  computeWeightedSimilarity(left, right) {
    const selfSimilarity = this.similarityWithFallback(left, right);
    if (left.unitType === "class" /* CLASS */) {
      return selfSimilarity * indexConfig.weights.class.self;
    }
    if (left.unitType === "function" /* FUNCTION */) {
      const weights2 = indexConfig.weights.function;
      const hasParentClass2 = !!this.findParentOfType(left, "class" /* CLASS */) && !!this.findParentOfType(right, "class" /* CLASS */);
      const parentClassSimilarity = hasParentClass2 ? this.parentSimilarity(left, right, "class" /* CLASS */) : 0;
      const totalWeight2 = weights2.self + (hasParentClass2 ? weights2.parentClass : 0);
      return (weights2.self * selfSimilarity + (hasParentClass2 ? weights2.parentClass * parentClassSimilarity : 0)) / totalWeight2;
    }
    const weights = indexConfig.weights.block;
    const hasParentFunction = !!this.findParentOfType(left, "function" /* FUNCTION */) && !!this.findParentOfType(right, "function" /* FUNCTION */);
    const hasParentClass = !!this.findParentOfType(left, "class" /* CLASS */) && !!this.findParentOfType(right, "class" /* CLASS */);
    const parentFuncSim = hasParentFunction ? this.parentSimilarity(left, right, "function" /* FUNCTION */) : 0;
    const parentClassSim = hasParentClass ? this.parentSimilarity(left, right, "class" /* CLASS */) : 0;
    const totalWeight = weights.self + (hasParentFunction ? weights.parentFunction : 0) + (hasParentClass ? weights.parentClass : 0);
    return (weights.self * selfSimilarity + (hasParentFunction ? weights.parentFunction * parentFuncSim : 0) + (hasParentClass ? weights.parentClass * parentClassSim : 0)) / totalWeight;
  }
  parentSimilarity(left, right, targetType) {
    const leftParent = this.findParentOfType(left, targetType);
    const rightParent = this.findParentOfType(right, targetType);
    if (!leftParent || !rightParent) return 0;
    return this.similarityWithFallback(leftParent, rightParent);
  }
  similarityWithFallback(left, right) {
    const leftHasEmbedding = this.hasVector(left);
    const rightHasEmbedding = this.hasVector(right);
    if (leftHasEmbedding && rightHasEmbedding) {
      return cosineSimilarity([left.embedding], [right.embedding])[0][0];
    }
    return this.childSimilarity(left, right);
  }
  childSimilarity(left, right) {
    const leftChildren = left.children ?? [];
    const rightChildren = right.children ?? [];
    if (leftChildren.length === 0 || rightChildren.length === 0) return 0;
    let best = 0;
    for (const lChild of leftChildren) {
      for (const rChild of rightChildren) {
        if (lChild.unitType !== rChild.unitType) continue;
        const sim = this.similarityWithFallback(lChild, rChild);
        if (sim > best) best = sim;
      }
    }
    return best;
  }
  hasVector(unit) {
    return Array.isArray(unit.embedding) && unit.embedding.length > 0;
  }
  shouldSkipComparison(left, right) {
    if (left.unitType !== "block" /* BLOCK */ || right.unitType !== "block" /* BLOCK */) {
      return false;
    }
    if (left.filePath !== right.filePath) {
      return false;
    }
    const leftContainsRight = left.startLine <= right.startLine && left.endLine >= right.endLine;
    const rightContainsLeft = right.startLine <= left.startLine && right.endLine >= left.endLine;
    return leftContainsRight || rightContainsLeft;
  }
  findParentOfType(unit, targetType) {
    let current = unit.parent;
    while (current) {
      if (current.unitType === targetType) return current;
      current = current.parent;
    }
    return null;
  }
  computeDuplicationScore(duplicates, allUnits) {
    const totalLines = this.calculateTotalLines(allUnits);
    if (totalLines === 0 || duplicates.length === 0) {
      return {
        score: 0,
        grade: "Excellent",
        totalLines,
        duplicateLines: 0,
        duplicateGroups: 0
      };
    }
    const weightedDuplicateLines = duplicates.reduce((sum, group) => {
      const leftLines = group.left.endLine - group.left.startLine + 1;
      const rightLines = group.right.endLine - group.right.startLine + 1;
      const avgLines = (leftLines + rightLines) / 2;
      return sum + group.similarity * avgLines;
    }, 0);
    const score = weightedDuplicateLines / totalLines * 100;
    const grade = this.getScoreGrade(score);
    return {
      score,
      grade,
      totalLines,
      duplicateLines: Math.round(weightedDuplicateLines),
      duplicateGroups: duplicates.length
    };
  }
  calculateTotalLines(units) {
    return units.reduce((sum, unit) => {
      const lines = unit.endLine - unit.startLine + 1;
      return sum + lines;
    }, 0);
  }
  getScoreGrade(score) {
    if (score < 5) return "Excellent";
    if (score < 15) return "Good";
    if (score < 30) return "Fair";
    if (score < 50) return "Poor";
    return "Critical";
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
    console.log("[DryScan] Preparing database and cache...");
    await configStore.init(this.repoPath);
    await this.ensureDatabase();
    if (await this.isInitialized()) {
      console.log("[DryScan] Repository already initialized; skipping full init.");
      return;
    }
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
    await this.services.updater.updateIndex();
    const duration = Date.now() - start;
    console.log(`[DryScan] Index update complete. Took ${duration}ms.`);
  }
  /**
   * Runs duplicate detection and returns a normalized report payload ready for persistence or display.
   */
  async buildDuplicateReport() {
    const config = await this.loadConfig();
    const analysis = await this.findDuplicates(config);
    return {
      version: 1,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      threshold: config.threshold,
      grade: analysis.score.grade,
      score: analysis.score,
      duplicates: analysis.duplicates
    };
  }
  /**
   * Finds duplicate code blocks using cosine similarity on embeddings.
   * Automatically updates the index before searching to ensure results are current.
   * Compares all function pairs and returns groups with similarity above the configured threshold.
   *
   * @returns Analysis result with duplicate groups and duplication score
   */
  async findDuplicates(config) {
    console.log(`[DryScan] Finding duplicates (threshold: ${config.threshold})...`);
    await this.ensureDatabase();
    console.log("[DryScan] Updating index...");
    const updateStart = Date.now();
    await this.updateIndex();
    const updateDuration = Date.now() - updateStart;
    console.log(`[DryScan] Index update  took ${updateDuration}ms.`);
    console.log("[DryScan] Detecting duplicates...");
    const dupStart = Date.now();
    const result = await this.services.duplicate.findDuplicates(config);
    const dupDuration = Date.now() - dupStart;
    console.log(`[DryScan] Duplicate detection took ${dupDuration}ms.`);
    return result;
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
    await fs7.mkdir(upath6.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);
  }
  async loadConfig() {
    return configStore.get(this.repoPath);
  }
  async isInitialized() {
    if (!this.db.isInitialized()) return false;
    const unitCount = await this.db.countUnits();
    const initialized = unitCount > 0;
    console.log(`[DryScan] Initialization check: ${unitCount} indexed units`);
    return initialized;
  }
};
export {
  DryScan,
  configStore
};
//# sourceMappingURL=index.js.map