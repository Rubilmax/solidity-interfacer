/* eslint-disable */

const fs = require('fs');
const path = require('path');
var assert = require('assert');

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
    description: 'The input contracts to generate interfaces for',
    typeLabel: '<files>',
  },
  {
    name: 'modulesRoot',
    type: String,
    description: 'The path to the node modules directory, relative to the working directory',
    typeLabel: '<path>',
    defaultValue: 'node_modules',
  },
  {
    name: 'targetRoot',
    type: String,
    description:
      "The path to the target interfaces directory, relative to the contract's directory",
    typeLabel: '<path>',
    defaultValue: 'interfaces',
  },
];

const options = commandLineArgs(optionDefinitions);

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

  const contractName = path.basename(options.src, '.sol');
  const interfaceSrc = path.join(
    path.dirname(options.src),
    options.targetRoot,
    `I${contractName}.sol`,
  );
  fs.writeFileSync(interfaceSrc, generateInterface(options));

  console.log(`📦  Interfaces for ${contractName} successfully generated at:`, interfaceSrc);
}
