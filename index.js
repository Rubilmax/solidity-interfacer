/* eslint-disable */

const fs = require("fs");
const path = require("path");

const parser = require("@solidity-parser/parser");

const toLookupObject = (obj, key) => {
  obj[key] = 1;
  return obj;
};

const isUserDefinedTypeName = (variable) =>
  variable.typeName.type === "UserDefinedTypeName";

function generateInterface(src, options = {}) {
  options.modulesRoot = options.modulesRoot || "node_modules";
  options.targetRoot = options.targetRoot || "interfaces";

  const contractRoot = path.dirname(src);

  console.log("🖨️  Interfacing:", src);
  const content = fs.readFileSync(src, "utf-8");
  const ast = parser.parse(content);

  const pragma = ast.children.find(
    (statement) => statement.type === "PragmaDirective"
  );
  if (!pragma) throw Error("🟥 No pragma found!");

  const contract = ast.children.find(
    (statement) => statement.type === "ContractDefinition"
  );
  if (!contract) throw Error("🟥 No contract definition found!");

  const supers = contract.baseContracts
    .map((supercontract) => supercontract.baseName.namePath)
    .reduce(toLookupObject, {});

  const userDefinedTypeNames = [];

  const interfaceParameter = (param) => {
    if (isUserDefinedTypeName(param))
      userDefinedTypeNames.push(param.typeName.namePath);

    return (
      (param.typeName.name || param.typeName.namePath || param.typeName.type) +
      (param.name ? ` ${param.name}` : "")
    );
  };

  const imports = ast.children
    .filter((statement) => statement.type === "ImportDirective")
    .map((statement) => ({
      ...statement,
      importName: path.basename(statement.path, ".sol"),
      relPath: path.join(
        statement.path.startsWith(".") ? contractRoot : options.modulesRoot,
        statement.path
      ),
    }));

  const inheritedStubs = imports
    .filter((statement) => statement.importName in supers)
    .map((statement) => ({
      ...statement,
      stubs: generateInterface(statement.relPath, {
        ...options,
        stubsOnly: true,
      }),
    }))
    .filter(({ stubs }) => !!stubs)
    .map(
      ({ importName, stubs }) =>
        `\n    // inherited from ${importName}\n${stubs}\n`
    );

  // generate a regular expression that matches any enum name that was defined in the contract
  const enumNames = contract.subNodes
    .filter((statement) => statement.type === "EnumDefinition")
    .map((en) => en.name);
  const enumRegexp = new RegExp(enumNames.join("|"), "g");
  const replaceEnums = (str) =>
    enumNames.length ? str.replace(enumRegexp, "uint") : str;

  // generate interface stubs for functions
  const functionStubs = contract.subNodes
    .filter(
      (statement) =>
        statement.type === "FunctionDefinition" &&
        !!statement.name && // fallback function does not have a name
        ["external", "public", "default"].includes(statement.visibility) &&
        (!statement.modifiers ||
          statement.modifiers.every(
            (mod) => mod.name !== "private" && mod.name !== "internal"
          ))
    )
    .map((f) => {
      const parameters = f.parameters.map(interfaceParameter).join(", ");
      const returnParameters = f.returnParameters
        ? f.returnParameters.map(interfaceParameter).join(", ")
        : "";

      const returns = `${
        returnParameters ? ` returns (${returnParameters})` : ""
      }`;

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
        statement.type === "StateVariableDeclaration" &&
        statement.variables.length > 0 &&
        statement.variables[0].visibility === "public"
    )
    .map((statement) => {
      const getter = statement.variables[0];

      if (isUserDefinedTypeName(getter))
        userDefinedTypeNames.push(getter.typeName.namePath);

      const paramType =
        getter.typeName.type === "Mapping" ? getter.typeName.keyType.name : "";

      const returnType =
        getter.typeName.type === "Mapping"
          ? getter.typeName.valueType.name
          : getter.typeName.namePath || getter.typeName.type;

      return `    function ${getter.name}(${paramType}) external view returns (${returnType});`;
    });

  const importRoot = path.join(contractRoot, options.targetRoot);
  const importStubs = imports
    .filter(({ importName }) => userDefinedTypeNames.includes(importName))
    .map(({ relPath }) => `import "${relPath.replace(importRoot, ".")}";`);

  const stubs = []
    .concat(inheritedStubs, getterStubs, functionStubs)
    .join("\n\n");
  if (options.stubsOnly) return stubs;

  return `// SPDX-License-Identifier: UNLICENSED
pragma ${pragma.name} ${pragma.value};

${importStubs.join("\n")}

interface I${contract.name} {
${stubs}
}`;
}

const [src] = process.argv.slice(2);
if (!src) throw new Error("Missing source file");

const contractName = path.basename(src, ".sol");
fs.writeFileSync(`I${contractName}.sol`, generateInterface(src));
