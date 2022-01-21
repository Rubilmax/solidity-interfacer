const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');

const parser = require('@solidity-parser/parser');

const isUserDefinedTypeName = (typeName) => typeName.type === 'UserDefinedTypeName';

const lookUpContracts = {};

const loadContract = async (src, logFiles) => {
  if (!(src in lookUpContracts)) {
    const exists = fs.existsSync(src);

    if (!exists) {
      if (!logFiles)
        console.log(
          colors.brightRed(
            `🟥 Trying to import file not found at ${colors.underline(
              src,
            )}: generated interfaces may not be complete!`,
          ),
        );

      lookUpContracts[src] = {
        interfaceName: '',
        userDefinedTypeNames: [],
        children: [],
        pragma: null,
        contract: null,
        structs: [],
      };

      return lookUpContracts[src];
    }

    const content = fs.readFileSync(src, 'utf-8');
    const { children } = parser.parse(content);

    const pragma = children.find((statement) => statement.type === 'PragmaDirective');
    if (!pragma) throw Error(`🟥 No pragma found at ${src}`);

    const contract = children.find((statement) => statement.type === 'ContractDefinition');
    if (!contract) throw Error(`🟥 No contract definition found at ${src}`);

    const interfaceName = contract
      ? (contract.kind !== 'interface' ? 'I' : '') + contract.name
      : '';

    const structs = contract.subNodes.filter((statement) => statement.type === 'StructDefinition');
    const userDefinedTypeNames = [contract.name].concat(structs.map(({ name }) => name));

    lookUpContracts[src] = {
      interfaceName,
      userDefinedTypeNames,
      children,
      pragma,
      contract,
      structs,
    };
  }

  return lookUpContracts[src];
};

const generateInterface = async (options) => {
  const { src, modulesRoot, targetRoot, license, logFiles, stubsOnly = false } = options;

  if (src in lookUpContracts) return lookUpContracts[src];

  const { interfaceName, userDefinedTypeNames, children, pragma, contract, structs } =
    await loadContract(src, logFiles);

  if (!pragma || !contract || !contract.kind.includes('contract')) {
    const stubs = '';

    lookUpContracts[src] = {
      interfaceName,
      userDefinedTypeNames,
      pragma,
      contract,
      children,
      structs,
      stubs,
    };

    return lookUpContracts[src];
  }

  if (!logFiles) console.log(colors.yellow(`🖨️  Interfacing: ${colors.underline(src)}`));

  const parents = contract.baseContracts.map((supercontract) => supercontract.baseName.namePath);

  const usedUserDefinedTypeNames = [];

  const getVariableTypeName = (typeName) => {
    if (isUserDefinedTypeName(typeName) && !usedUserDefinedTypeNames.includes(typeName.namePath))
      usedUserDefinedTypeNames.push(typeName.namePath);

    if (isUserDefinedTypeName(typeName)) return ''; // ! temporary

    if (typeName.type === 'ArrayTypeName')
      return getVariableTypeName(typeName.baseTypeName) + '[] memory';
    if (typeName.type !== 'Mapping') return typeName.name || typeName.namePath || typeName.type;

    return getVariableTypeName(typeName.valueType);
  };

  const getGetterParamTypeNames = (typeName) => {
    if (typeName.type !== 'Mapping') return [];

    return [getVariableTypeName(typeName.keyType)].concat(
      getGetterParamTypeNames(typeName.valueType),
    );
  };

  const interfaceParameter = (param) =>
    getVariableTypeName(param.typeName) + (param.name ? ` ${param.name}` : '');

  // generate interface stubs for functions
  const functionStubs = contract.subNodes
    .filter(
      (statement) =>
        statement.type === 'FunctionDefinition' &&
        !!statement.name && // fallback function does not have a name
        ['external', 'public', 'default'].includes(statement.visibility) &&
        (!statement.parameters ||
          !statement.parameters.some((param) => isUserDefinedTypeName(param.typeName))) && // ! temporary
        (!statement.returnParameters ||
          !statement.returnParameters.some((param) => isUserDefinedTypeName(param.typeName))),
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
      const { name, typeName } = statement.variables[0];

      const paramTypeNames = getGetterParamTypeNames(typeName).filter(Boolean).join(', ');
      const returnTypeName = getVariableTypeName(typeName);

      if (!paramTypeNames || !returnTypeName) return ''; // ! temporary

      return `    function ${name}(${paramTypeNames}) external view returns (${returnTypeName});`;
    })
    .filter(Boolean);

  const contractRoot = path.dirname(src);
  const imports = children
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

  const inheritedInterfaces = await Promise.all(
    imports
      .filter(({ importName }) => parents.includes(importName) && interfaceName !== importName)
      .map(async (statement) => {
        const interface = await generateInterface({
          ...options,
          stubsOnly: true,
          src: statement.relPath,
        });

        return {
          ...statement,
          ...interface,
        };
      }),
  );
  const validInheritedInterfaces = inheritedInterfaces.filter(({ interfaceName }) => interfaceName);

  const inheritedStubs = validInheritedInterfaces
    .filter(({ stubs }) => !!stubs)
    .map(({ importName, stubs }) => `\n    // inherited from ${importName}\n${stubs}\n`);

  const importRoot = path.join(contractRoot, targetRoot);
  const importStubs = (
    await Promise.all(
      imports.map(async ({ relPath }) => {
        const { userDefinedTypeNames } = await loadContract(relPath, logFiles);

        const isUsed = userDefinedTypeNames.some((userDefinedTypeName) =>
          usedUserDefinedTypeNames.includes(userDefinedTypeName),
        );

        return { relPath, isUsed };
      }),
    )
  )
    .filter(({ isUsed }) => isUsed)
    // .concat(
    //   validInheritedInterfaces.map(({ relPath, interfaceName }) => ({
    //     relPath: path
    //       .join(path.dirname(relPath), targetRoot, `${interfaceName}.sol`)
    //       .replace(importRoot, '.'),
    //   })),
    // )
    .map(({ relPath }) => `import "${relPath.replace(importRoot, '.')}";\n`)
    .join('');

  const importedUserDefinedTypeNames = inheritedInterfaces.flatMap(
    ({ userDefinedTypeNames }) => userDefinedTypeNames,
  );

  const newUserDefinedTypeNames = usedUserDefinedTypeNames.filter(
    (userDefinedTypeName) => !importedUserDefinedTypeNames.includes(userDefinedTypeName),
  );

  // generate interface stubs for public structs
  const structStubs = structs
    .filter((statement) => newUserDefinedTypeNames.includes(statement.name))
    .map((statement) => {
      const structMembers = statement.members
        .map((structMember) => `        ${interfaceParameter(structMember)};`)
        .join('\n');

      return `    struct ${statement.name} {\n${structMembers}\n    }`;
    });

  const stubs = []
    .concat(
      inheritedStubs,
      //structStubs, // temporary
      getterStubs,
      functionStubs,
    )
    .join('\n\n');

  lookUpContracts[src] = {
    interfaceName,
    userDefinedTypeNames,
    pragma,
    contract,
    children,
    structs,
    stubs,
  };

  if (stubsOnly) return lookUpContracts[src];

  const inheritanceStub = '';
  // validInheritedInterfaces.length > 0
  //   ? ' is ' + validInheritedInterfaces.map(({ interfaceName }) => interfaceName).join(', ')
  //   : ''; // ! temporary

  const interface = `// SPDX-License-Identifier: ${license}
pragma ${pragma.name} ${pragma.value};
${importStubs.length > 0 ? '\n' : ''}${importStubs}
interface ${interfaceName}${inheritanceStub} {
${stubs}
}`;

  const interfaceSrc = path.join(importRoot, `${interfaceName}.sol`);
  await fs.writeFileSync(interfaceSrc, interface);

  if (!logFiles)
    console.log(
      `📦   Successfully generated interface for ${colors.bold(contract.name)} at:`,
      colors.underline(interfaceSrc),
    );
  else console.log(interfaceSrc);

  return lookUpContracts[src];
};

module.exports = generateInterface;
