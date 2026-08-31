// TypeScript is type-checked by tsc; keep ESLint's flat-config scope explicit
// because the core parser does not parse TypeScript syntax.
export default [
  { ignores: ['dist/**', 'node_modules/**', '**/*.{ts,tsx}'] },
  { files: ['**/*.{js,mjs,cjs}'], rules: { 'no-undef': 'error' } },
];
