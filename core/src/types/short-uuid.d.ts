declare module "short-uuid" {
  export function generate(): string;
  const shortUuid: {
    generate: () => string;
  };
  export default shortUuid;
}
