#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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
];

const options = commandLineArgs(optionDefinitions);

const generateInterfaces = async (src) => {
  const contractPaths = await Promise.all(options.src.map(glob)).then((globs) =>
    globs.map(({ pattern }) => pattern),
  );

  return Promise.all(
    contractPaths.map((contractPath) => {
      const contractName = path.basename(contractPath, '.sol');
      const interfaceSrc = path.join(
        path.dirname(contractPath),
        options.targetRoot,
        `I${contractName}.sol`,
      );
      fs.writeFileSync(interfaceSrc, generateInterface({ ...options, src: contractPath }));

      console.log(`📦  Interfaces for ${contractName} successfully generated at:`, interfaceSrc);
    }),
  );
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
} else {
  assert(options.src, '🟥 No source file specified!');

  generateInterfaces(options.src);
}
