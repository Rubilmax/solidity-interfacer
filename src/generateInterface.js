const fs = require('fs');
const path = require('path');
const colors = require('colors/safe');

const parser = require('@solidity-parser/parser');

const {
  STATEMENT_TYPE,
  isUserDefinedTypeName,
  isStatement,
  isStatementPublic,
} = require('./utils');

const lookUpContracts = {};

const loadFakeContract = (src, logFiles) => {
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
    structTypeNames: [],
    comments: [],
    interfaceSrc: src,
    interfaceSrcs: [],
  };

  return lookUpContracts[src];
};

const loadContract = async (options) => {
  const { src, modulesRoot, targetRoot, logFiles } = options;

  if (!(src in lookUpContracts)) {
    const exists = fs.existsSync(src);
    if (!exists) return loadFakeContract(src, logFiles);

    const content = fs.readFileSync(src, 'utf-8');
    const { children } = parser.parse(content);

    const lines = content.split('\n');

    const pragmaLineIndex = lines.findIndex((line) => line.includes('pragma'));
    const comments = lines
      .slice(0, Math.max(0, pragmaLineIndex))
      .map((line) => line.replace(/^\s+|\s+$/g, ''))
      .filter((line) => line.startsWith('//'));

    const pragma = children.find(isStatement(STATEMENT_TYPE.PRAGMA_DIRECTIVE));
    if (!pragma) throw Error(`🟥 No pragma found at ${src}`);

    const contract = children.find(isStatement(STATEMENT_TYPE.CONTRACT_DEFINITION));
    if (!contract) throw Error(`🟥 No contract definition found at ${src}`);

    const structs = contract.subNodes.filter(isStatement(STATEMENT_TYPE.STRUCT_DEFINITION));
    const structTypeNames = structs.map(({ name }) => name); // ! structTypeNames is currently restricted to the contract's definition scope

    const userDefinedTypeNames = [contract.name].concat(structTypeNames);

    const interfaceName = contract
      ? (contract.kind !== 'interface' ? 'I' : '') + contract.name
      : '';

    lookUpContracts[src] = {
      interfaceName,
      children,
      pragma,
      contract,
      userDefinedTypeNames,
      structs,
      structTypeNames,
      comments,
      interfaceSrcs: [],
    };
  }

  return lookUpContracts[src];
};

const generateInterface = async (options) => {
  const { src, modulesRoot, logFiles, onlyRawTypes } = options;

  const srcRoot = path.dirname(src);
  options.targetRoot = options.targetRoot || path.join(srcRoot, 'interfaces');

  const {
    interfaceName,
    children,
    pragma,
    contract,
    userDefinedTypeNames,
    structs,
    structTypeNames,
    comments,
    interfaceSrcs,
  } = await loadContract(options);

  if (!pragma || !contract) return { ...lookUpContracts[src], interfaceSrc: src };

  const generatedInterfaceSrc = interfaceSrcs.find((interfaceSrc) =>
    interfaceSrc.startsWith(options.targetRoot),
  );
  if (generatedInterfaceSrc)
    return { ...lookUpContracts[src], interfaceSrc: generatedInterfaceSrc };

  const isModule = src.startsWith(modulesRoot);
  const interfaceSrc =
    contract.kind === 'interface'
      ? src
      : path.join(
          options.targetRoot,
          isModule ? `dependencies/${src.split('/')[1]}` : '',
          `${interfaceName}.sol`,
        );

  if (contract.kind === 'interface' || contract.kind === 'library')
    return { ...lookUpContracts[src], interfaceSrc };

  const importRoot = path.dirname(interfaceSrc);
  if (!lookUpContracts[src].interface) {
    if (!logFiles) console.log(colors.yellow(`🖨️  Interfacing: ${colors.underline(src)}`));

    const parents = contract.baseContracts
      .map((supercontract) => supercontract.baseName.namePath)
      .filter((parent) => parent !== interfaceName);

    const usedUserDefinedTypeNames = [].concat(parents);

    const getVariableTypeName = (typeName, dataLocation = '') => {
      if (isUserDefinedTypeName(typeName)) {
        if (onlyRawTypes) return ''; // not registering the unwanted user-defined type as used

        if (!usedUserDefinedTypeNames.includes(typeName.namePath))
          usedUserDefinedTypeNames.push(typeName.namePath);

        if (structTypeNames.includes(typeName.namePath) && !dataLocation) dataLocation = 'memory';

        return typeName.namePath + (!!dataLocation ? ` ${dataLocation}` : '');
      }

      if (typeName.name === 'string') return `string ${dataLocation || 'memory'}`;
      if (typeName.type === 'ArrayTypeName')
        return getVariableTypeName(typeName.baseTypeName) + `[] ${dataLocation || 'memory'}`;
      if (typeName.type === 'Mapping') return getVariableTypeName(typeName.valueType); // ! we don't always want the value type... (e.g. in the case of a mapping type returned from a function)

      return typeName.name || typeName.type;
    };

    const getGetterParamTypeNames = (typeName) => {
      if (typeName.type !== 'Mapping') return [];

      return [getVariableTypeName(typeName.keyType)].concat(
        getGetterParamTypeNames(typeName.valueType),
      );
    };

    const interfaceParameter = (param) => {
      const typeName = getVariableTypeName(param.typeName, param.storageLocation);
      if (!typeName) return '';

      return typeName + (param.name ? ` ${param.name}` : '');
    };

    // 1. generate stubs for functions
    const functionStubs = contract.subNodes
      .filter(
        (statement) =>
          isStatement(STATEMENT_TYPE.FUNCTION_DEFINITION)(statement) &&
          isStatementPublic(statement) &&
          !!statement.name, // fallback function does not have a name,
      )
      .map((f) => {
        const parameters = f.parameters.map(interfaceParameter);
        const returnParameters = f.returnParameters
          ? f.returnParameters.map(interfaceParameter)
          : [];

        if (parameters.includes('') || returnParameters.includes('')) return ''; // an unwanted user-defined type was used

        const returns = `${
          returnParameters.length > 0 ? ` returns (${returnParameters.join(', ')})` : ''
        }`;

        // ! need to implement Enum stubs
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

        return `    function ${f.name}(${parameters.join(', ')}) external${returns};`;
      })
      .filter(Boolean); // filtering out empty stubs because of unwanted user-defined types

    // 2. generate stubs for public variable getters
    const getterStubs = contract.subNodes
      .filter(
        (statement) =>
          isStatement(STATEMENT_TYPE.STATE_VARIABLE_DECLARATION)(statement) &&
          statement.variables.length > 0 &&
          statement.variables[0].visibility === 'public',
      )
      .map((statement) => {
        const { name, typeName, storageLocation } = statement.variables[0];

        const paramTypeNames = getGetterParamTypeNames(typeName);
        const returnTypeName = getVariableTypeName(typeName, storageLocation);

        if (paramTypeNames.includes('') || !returnTypeName) return ''; // an unwanted user-defined type was used

        return `    function ${name}(${paramTypeNames.join(
          ', ',
        )}) external view returns (${returnTypeName});`;
      })
      .filter(Boolean); // filtering out empty stubs because of unwanted user-defined types

    // 3. generate stubs for imported contracts
    const imports = await Promise.all(
      children.filter(isStatement(STATEMENT_TYPE.IMPORT_DIRECTIVE)).map(async (statement) => {
        const importDir = statement.path.startsWith('.') ? srcRoot : modulesRoot;
        const relPath = path.join(importDir, statement.path);

        const { userDefinedTypeNames, interfaceName } = await loadContract({
          ...options,
          src: relPath,
        });

        const isUsed = userDefinedTypeNames.some((userDefinedTypeName) =>
          usedUserDefinedTypeNames.includes(userDefinedTypeName),
        );

        return {
          ...statement,
          importName: path.basename(statement.path, '.sol'),
          interfaceName,
          relPath,
          isUsed,
        };
      }),
    );

    const importedInterfaces = await Promise.all(
      imports
        .filter(({ interfaceName, isUsed }) => !!interfaceName && isUsed)
        .map(async (statement) => {
          const interface = await generateInterface({
            ...options,
            src: statement.relPath,
          });

          return {
            ...statement,
            ...interface,
          };
        }),
    );

    const importStubs = importedInterfaces
      .map(
        ({ interfaceSrc }) =>
          `import "${interfaceSrc.replace(importRoot, '.').replace(/^\//, '')}";\n`,
      )
      .join('');

    const inheritedInterfaces = importedInterfaces
      .filter(({ importName }) => parents.includes(importName))
      .map(({ interfaceName }) => interfaceName)
      .join(', ');
    const inheritanceStub = inheritedInterfaces ? ` is ${inheritedInterfaces}` : '';

    // 4. generate interface stubs for public structs
    const structStubs = structs
      .filter((statement) => userDefinedTypeNames.includes(statement.name))
      .map((statement) => {
        const structMembers = statement.members
          .map((structMember) => `        ${interfaceParameter(structMember)};`)
          .join('\n');

        return `    struct ${statement.name} {\n${structMembers}\n    }`;
      });

    const stubs = []
      .concat(!onlyRawTypes ? structStubs : [], getterStubs, functionStubs)
      .join('\n\n');

    Object.assign(lookUpContracts[src], {
      interface: `${comments.join('\n')}
pragma ${pragma.name} ${pragma.value};
${importStubs.length > 0 ? '\n' : ''}${importStubs}
interface ${interfaceName}${inheritanceStub} {
${stubs}
}`,
    });
  }

  lookUpContracts[src].interfaceSrcs.push(interfaceSrc);

  if (!fs.existsSync(importRoot)) fs.mkdirSync(importRoot, { recursive: true });
  await fs.writeFileSync(interfaceSrc, lookUpContracts[src].interface);

  if (!logFiles)
    console.log(
      `📦   Successfully generated interface for ${colors.bold(contract.name)} at:`,
      colors.underline(interfaceSrc),
    );
  else console.log(interfaceSrc);

  return { ...lookUpContracts[src], interfaceSrc };
};

module.exports = generateInterface;
