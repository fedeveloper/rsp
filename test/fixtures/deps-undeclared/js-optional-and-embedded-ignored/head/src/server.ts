import express from 'express';
import type { Request } from 'express';
import { config } from '@app/config';
import { util } from 'utils/strings';

let fast;
try {
  fast = require('fast-json-stringify');
} catch {
  fast = undefined;
}

const lazy = () => import('sharp');

// import chalk from 'chalk';
/*
import ora from 'ora';
*/
const template = `
import left from 'left-pad';
`;
