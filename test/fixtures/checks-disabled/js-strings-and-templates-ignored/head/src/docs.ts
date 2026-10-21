export const rule = "Never add // eslint-disable or /* @ts-ignore */";
export const sample = 'const pad = require("left-pad")';
export const snippet = `
// @ts-nocheck
import chalk from 'chalk';
const key = process.env.SECRET_KEY;
`;
export const hint = `use ${'`'}it.skip${'`'}`;
export const patch = ["const { API_TOKEN } = process.env;"];
