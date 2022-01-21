#!/usr/bin/env node

var assert = require('assert');
const glob = require('glob');

const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const generateInterface = require('./generateInterface');

const optionDefinitions = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Display this usage guide.',
  },
  {
    name: 'src',
    type: String,
    multiple: true,
    description:
      'The relative paths to input contracts to generate interfaces for. Can be relative globs.',
    typeLabel: '<files>',
    defaultOption: true,
  },
  {
    name: 'modulesRoot',
    type: String,
    description: 'The path to the node modules directory, relative to the working directory.',
    typeLabel: '<path>',
    defaultValue: 'node_modules',
  },
  {
    name: 'targetRoot',
    type: String,
    description:
      "The path to the target interfaces directory, relative to the contract's directory.",
    typeLabel: '<path>',
    defaultValue: 'interfaces',
  },
  {
    name: 'license',
    type: String,
    description: "The SPDX license's identifier added to the start of each generated interface.",
    defaultValue: 'UNLICENSED',
  },
];

const options = commandLineArgs(optionDefinitions);

const generateInterfaces = async () => {
  const contractPaths = options.src
    .flatMap((src) => glob.sync(src))
    .filter((path) => path.endsWith('.sol'));

  return Promise.all(contractPaths.map((src) => generateInterface({ ...options, src })));
};

if (options.help) {
  console.log(
    commandLineUsage([
      {
        header: 'Solidity Interfacer',
        content: "🚀🖨️  Automatically generates your Solidity contracts' interfaces",
      },
      {
        header: 'Options',
        optionList: optionDefinitions,
      },
      {
        content: 'Project home: {underline https://github.com/rubilmax/solidity-interfacer}',
      },
    ]),
  );
} else generateInterfaces();
