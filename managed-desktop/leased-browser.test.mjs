import fs from 'node:fs/promises';import ts from 'typescript';
// Pure harness transpilation keeps actual transport/race tests runnable on Node20.
if(process.platform!=='win32'){
 const compile=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
 const transport=compile(await fs.readFile(new URL('./patches/gate-c-5.ts',import.meta.url),'utf8'));
 const tests=(await fs.readFile(new URL('./leased-browser.test.ts',import.meta.url),'utf8')).replaceAll('./patches/gate-c-5.ts',transport);
 await import(compile(tests));
}
