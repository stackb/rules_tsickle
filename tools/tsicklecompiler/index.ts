
import * as path from 'path';
import * as fs from 'fs';
import { promises as asyncfs } from 'fs';
import ts from 'typescript';
import * as tsickle from '../../vendor/tsickle/src/tsickle';

const DEBUG = false;

function getExternsPath(): string | undefined {
    return process.env.EXTERNS_PATH;
}

function getExecRoot(): string {
    return process.env.JS_BINARY__EXECROOT || '.';
}

function getBazelBinDir(): string {
    const binDir = process.env.BAZEL_BINDIR!;
    return path.join(getExecRoot(), binDir);
}

async function listFiles(dir: string): Promise<string[]> {
    return asyncfs.readdir(dir, { recursive: true });
}

async function listExecrootFiles() {
    const execroot = process.env.JS_BINARY__EXECROOT || '.';
    for (const filename of await listFiles(execroot)) {
        if (filename.indexOf('.aspect_rules_js') >= 0) {
            continue;
        }
        if (filename.indexOf('tsconfig.json') < 0) {
            continue;
        }
        console.log(`{execroot}/${filename}`);
    }
}

function getInputFiles(execRoot: string, args: string[]): string[] {
    return args.map(arg => `${execRoot}/${arg}`);
}

function getTsCompilerOptions(): ts.CompilerOptions {
    return {
        target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.CommonJS,
        outDir: getBazelBinDir(),
        rootDir: getExecRoot(),
        declaration: true,
        importHelpers: true,
        strict: true
    };
}

/**
 * stripExternalName is used to remove external workspace identifiers from bazel
 * paths.  This allows the filenames
 * BAZEL_BIN/external/io_bazel_rules_closure+/google3/third_party/javascript/safevalues/builders/html_sanitizer/sanitizer_table/sanitizer_table.js
 * and
 * BAZEL_BIN/google3/third_party/javascript/safevalues/builders/html_sanitizer/sanitizer_table/sanitizer_table.js
 * to generate the same moduleName.
 *
 * @param moduleName the module name to strip
 * @returns 
 */
function stripExternalName(moduleName: string): string {
    if (!moduleName.startsWith('external.')) {
        return moduleName;
    }
    const parts = moduleName.split('.');
    if (parts.length <= 2) {
        return moduleName;
    }
    return parts.slice(2).join('.');
}

function run(
    options: ts.CompilerOptions,
    fileNames: string[],
    writeFile: ts.WriteFileCallback,
): tsickle.EmitResult {
    // Use absolute paths to determine what files to process since files may be
    // imported using relative or absolute paths
    fileNames = fileNames.map(i => path.resolve(i));

    const compilerHost = ts.createCompilerHost(options);
    const program = ts.createProgram(fileNames, options, compilerHost);
    const filesToProcess = new Set(fileNames);
    const rootModulePath = options.rootDir!;

    const transformerHost: tsickle.TsickleHost = {
        rootDirsRelative: (f: string) => f,
        shouldSkipTsickleProcessing: (fileName: string) => {
            return !filesToProcess.has(path.resolve(fileName));
        },
        shouldIgnoreWarningsForPath: (fileName: string) => false,
        pathToModuleName: (context, fileName) => {
            const moduleName = stripExternalName(tsickle.pathToModuleName(rootModulePath, context, fileName));
            if (DEBUG) {
                console.log(`pathToModuleName: ${fileName} => ${moduleName}`);
            }
            return moduleName;
        },
        fileNameToModuleId: (fileName) => {
            const moduleId = path.relative(rootModulePath, fileName);
            if (DEBUG) {
                console.log(`fileNameToModuleId: ${fileName} => ${moduleId}`);
            }
            return moduleId;
        },
        googmodule: true,
        transformDecorators: true,
        transformTypesToClosure: true,
        typeBlackListPaths: new Set(),
        untyped: false,
        logWarning: (warning) =>
            console.error(ts.formatDiagnostics([warning], compilerHost)),
        options,
        generateExtraSuppressions: false,
        provideExternalModuleDtsNamespace: true,
        transformDynamicImport: "closure",
    };

    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
        return {
            tsMigrationExportsShimFiles: new Map(),
            diagnostics,
            modulesManifest: new tsickle.ModulesManifest(),
            externs: {},
            emitSkipped: true,
            emittedFiles: [],
            fileSummaries: new Map(),
        };
    }

    return tsickle.emit(program, transformerHost, writeFile);
}

async function main() {
    const execRoot = getExecRoot();
    const externsPath = getExternsPath();

    const args = process.argv.slice(2);
    const inputFiles = getInputFiles(execRoot, args);
    if (inputFiles.length === 0) {
        console.error('Usage: tsicklecompiler <input.ts> [input2.ts] ...');
        process.exit(1);
    }

    const compilerOptions = getTsCompilerOptions();

    if (DEBUG) {
        const cwd = process.cwd()
        console.log('env:', process.env);
        console.log('pwd:', cwd);
        console.log('args:', args);
        console.log('inputFiles:', inputFiles);
        console.log('execRoot:', execRoot);
        console.log('compilerOptions:', compilerOptions);
    }

    const result = run(compilerOptions, inputFiles, (filePath: string, contents: string) => {
        if (DEBUG) {
            console.log('emitted file:', filePath);
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, contents, { encoding: 'utf-8' });
    });

    if (result.diagnostics.length) {
        console.error(ts.formatDiagnostics(result.diagnostics, ts.createCompilerHost(compilerOptions)));
        return 1;
    }

    if (externsPath) {
        fs.mkdirSync(path.dirname(externsPath), { recursive: true });
        fs.writeFileSync(
            externsPath,
            tsickle.getGeneratedExterns(result.externs, compilerOptions.rootDir || ''));
    }

    return 0;
}

void main()
