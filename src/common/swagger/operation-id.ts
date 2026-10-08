const snake = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();

/** `UsersController` + `listUsers` -> `users_list_users`: stable ids for FE type generation. */
export function operationIdFactory(
  controllerKey: string,
  methodKey: string,
): string {
  return `${snake(controllerKey.replace(/Controller$/, ''))}_${snake(methodKey)}`;
}
