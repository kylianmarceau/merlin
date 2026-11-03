// Inspect localizable presentation only. Never rewrite identifiers or URLs.
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
const ts = require(path.join(src, 'third_party/node/node_modules/typescript/lib/typescript.js'));
const root = path.join(src, 'third_party/devtools-frontend/src');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../branding/devtools_strings.json'), 'utf8'));
const tracked = new Set(manifest.map(x => `${x.file} | ${x.key}`));
const found = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['third_party', 'node_modules', 'testing', 'test_runner'].includes(e.name)) walk(p);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      const source = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
      const file = path.relative(root, p);
      function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'UIStrings') {
          let obj = node.initializer;
          while (obj && (ts.isAsExpression(obj) || ts.isSatisfiesExpression(obj))) obj = obj.expression;
          if (obj && ts.isObjectLiteralExpression(obj)) {
            for (const prop of obj.properties) {
              const val = prop.initializer;
              if (val && (ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val))) {
                const key = prop.name.getText(source);
                if (/\b(?:Chrome|Chromium)\b/.test(val.text) || tracked.has(`${file} | ${key}`)) {
                  found.push({file, key, value: val.text});
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
walk(path.join(root, 'front_end'));
process.stdout.write(JSON.stringify(found));
