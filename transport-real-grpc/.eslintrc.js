module.exports = {
    root: true,
    ignorePatterns: ['dist/**/*', '.eslintrc.js'],
    parserOptions: {
        project: 'tsconfig.json',
    },
    env: {
        node: true,
        jest: true,
    },
    extends: [
        '@mobile-reality/eslint-config/node-typescript', // base config
        'prettier',
        'plugin:prettier/recommended', // to include prettier rules in eslint
        'plugin:security/recommended',
    ],
    plugins: ['unused-imports'],
    // if jest is used jest config should be added to overrides section
    overrides: [],
    rules: {
        '@typescript-eslint/no-unused-vars': 'error',
        'unused-imports/no-unused-imports': 'error',
        'unicorn/prefer-node-protocol': 'off',
        'unicorn/no-static-only-class': 'off',
        'unicorn/no-array-for-each': 'off',
        'unicorn/prefer-module': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/consistent-type-definitions': 'off',
        '@typescript-eslint/no-extraneous-class': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
        'spaced-comment': 'off',
        'no-inline-comments': 'off',
        'line-comment-position': 'off',
        'prefer-destructuring': 'off',
        'no-negated-condition': 'off',
        'security/detect-object-injection': 'off',
    },
};
