const STATEMENT_TYPE = {
  STRUCT_DEFINITION: 'StructDefinition',
  PRAGMA_DIRECTIVE: 'PragmaDirective',
  CONTRACT_DEFINITION: 'ContractDefinition',
  FUNCTION_DEFINITION: 'FunctionDefinition',
  STATE_VARIABLE_DECLARATION: 'StateVariableDeclaration',
  IMPORT_DIRECTIVE: 'ImportDirective',
};

const publicVisibilityModifiers = ['external', 'public', 'default'];

const isUserDefinedTypeName = (typeName) => typeName.type === 'UserDefinedTypeName';

const isStatement = (statementType) => (statement) => statement.type === statementType;

const isStatementPublic = (statement) => publicVisibilityModifiers.includes(statement.visibility);

module.exports = {
  STATEMENT_TYPE,
  publicVisibilityModifiers,
  isUserDefinedTypeName,
  isStatement,
  isStatementPublic,
};
