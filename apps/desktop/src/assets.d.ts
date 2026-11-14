// Non-code imports that esbuild bundles into the main script as text.
declare module "*.lua" {
  const text: string;
  export default text;
}
