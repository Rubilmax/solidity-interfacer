const fs = require('fs');
const path = require('path');

const parser = require('@solidity-parser/parser');

const toLookupObject = (obj, key) => {
  obj[key] = 1;
  return obj;
};

const isUserDefinedTypeName = (variable) => variable.typeName.type === 'UserDefinedTypeName';

const generateInterface = (options) => {
  const { src, modulesRoot, targetRoot, stubsOnly } = options;

  console.log('🖨️  Interfacing:', src);

  const contractRoot = path.dirname(src);

  const content = fs.readFileSync(src, 'utf-8');
  const ast = parser.parse(content);

  const pragma = ast.children.find((statement) => statement.type === 'PragmaDirective');
  if (!pragma) throw Error('🟥 No pragma found!');

  const contract = ast.children.find((statement) => statement.type === 'ContractDefinition');
  if (!contract) throw Error('🟥 No contract definition found!');

  const supers = contract.baseContracts
    .map((supercontract) => supercontract.baseName.namePath)
    .reduce(toLookupObject, {});

  const userDefinedTypeNames = [];

  const interfaceParameter = (param) => {
    if (isUserDefinedTypeName(param)) userDefinedTypeNames.push(param.typeName.namePath);

    return (
      (param.typeName.name || param.typeName.namePath || param.typeName.type) +
      (param.name ? ` ${param.name}` : '')
    );
  };

  const imports = ast.children
    .filter((statement) => statement.type === 'ImportDirective')
    .map((statement) => {
      const importDir = statement.path.startsWith('.') ? contractRoot : modulesRoot;

      return {
        ...statement,
        importName: path.basename(statement.path, '.sol'),
        importDir,
        relPath: path.join(importDir, statement.path),
      };
    });

  const inheritedStubs = imports
    .filter((statement) => statement.importName in supers)
    .filter((statement) => {
      const exists = fs.existsSync(statement.relPath);

      if (!exists)
        console.log(
          `🟥 Contract ${contract.name} was trying to import ${statement.path} not found in ${statement.importDir}: interfaces may not be complete!`,
        );

      return exists;
    })
    .map((statement) => ({
      ...statement,
      stubs: generateInterface({
        ...options,
        stubsOnly: true,
        src: statement.relPath,
      }),
    }))
    .filter(({ stubs }) => !!stubs)
    .map(({ importName, stubs }) => `\n    // inherited from ${importName}\n${stubs}\n`);

  // generate a regular expression that matches any enum name that was defined in the contract
  const enumNames = contract.subNodes
    .filter((statement) => statement.type === 'EnumDefinition')
    .map((en) => en.name);
  const enumRegexp = new RegExp(enumNames.join('|'), 'g');
  const replaceEnums = (str) => (enumNames.length ? str.replace(enumRegexp, 'uint') : str);

  // generate interface stubs for functions
  const functionStubs = contract.subNodes
    .filter(
      (statement) =>
        statement.type === 'FunctionDefinition' &&
        !!statement.name && // fallback function does not have a name
        ['external', 'public', 'default'].includes(statement.visibility) &&
        (!statement.modifiers ||
          statement.modifiers.every((mod) => mod.name !== 'private' && mod.name !== 'internal')),
    )
    .map((f) => {
      const parameters = f.parameters.map(interfaceParameter).join(', ');
      const returnParameters = f.returnParameters
        ? f.returnParameters.map(interfaceParameter).join(', ')
        : '';

      const returns = `${returnParameters ? ` returns (${returnParameters})` : ''}`;

      // get privacy and other non-custom modifiers
      //   const notModifiers = f.notModifiers.length
      //     ? // replace enums in returns with uint
      //       " " +
      //       f.notModifiers
      //         .map((notMod) =>
      //           replaceEnums(src.slice(notMod.start, notMod.end).trim())
      //         )
      //         .join(" ")
      //     : "";

      return `    function ${f.name}(${parameters}) external${returns};`;
    });

  // generate interface stubs for public variable getters
  const getterStubs = contract.subNodes
    .filter(
      (statement) =>
        statement.type === 'StateVariableDeclaration' &&
        statement.variables.length > 0 &&
        statement.variables[0].visibility === 'public',
    )
    .map((statement) => {
      const getter = statement.variables[0];

      if (isUserDefinedTypeName(getter)) userDefinedTypeNames.push(getter.typeName.namePath);

      const paramType = getter.typeName.type === 'Mapping' ? getter.typeName.keyType.name : '';

      const returnType =
        getter.typeName.type === 'Mapping'
          ? getter.typeName.valueType.name
          : getter.typeName.namePath || getter.typeName.type;

      return `    function ${getter.name}(${paramType}) external view returns (${returnType});`;
    });

  const importRoot = path.join(contractRoot, targetRoot);
  const importStubs = imports
    .filter(({ importName }) => userDefinedTypeNames.includes(importName))
    .map(({ relPath }) => `import "${relPath.replace(importRoot, '.')}";`);

  const stubs = [].concat(inheritedStubs, getterStubs, functionStubs).join('\n\n');
  if (stubsOnly) return stubs;

  return `// SPDX-License-Identifier: UNLICENSED
pragma ${pragma.name} ${pragma.value};

${importStubs.join('\n')}

interface I${contract.name} {
${stubs}
}`;
};

module.exports = generateInterface;
