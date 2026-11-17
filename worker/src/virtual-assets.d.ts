declare module "virtual:assets" {
  const assets: Record<string, { type: string; b64: string }>
  export default assets
}
