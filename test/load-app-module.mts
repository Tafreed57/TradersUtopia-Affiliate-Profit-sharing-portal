import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const requirePackage = createRequire(import.meta.url);

/** Execute real service code with explicit IO boundaries replaced by test doubles. */
export function loadAppModule<T>(path: string, mocks: Record<string, unknown>): T {
  const cache = new Map<string, unknown>();
  function load(sourcePath: string): unknown {
    if (cache.has(sourcePath)) return cache.get(sourcePath);
    const filename = fileURLToPath(new URL(`../${sourcePath}`, import.meta.url));
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loadedModule = { exports: {} };
    cache.set(sourcePath, loadedModule.exports);
    runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, console, process, Date, URL, Set, Map,
      require: (specifier: string) => {
        if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
        if (specifier.startsWith("@/")) return load(`src/${specifier.slice(2)}.ts`);
        if (specifier.startsWith(".")) {
          const relative = posix.join(posix.dirname(sourcePath), specifier);
          return load(relative.endsWith(".ts") ? relative : `${relative}.ts`);
        }
        return requirePackage(specifier);
      },
    }, { filename });
    return loadedModule.exports;
  }
  return load(path) as T;
}
