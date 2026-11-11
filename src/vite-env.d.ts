/// <reference types="vite/client" />
declare module "regenerator-runtime/runtime";
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_TESSDATA_URL?: string;
}
