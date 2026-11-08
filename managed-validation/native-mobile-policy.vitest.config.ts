import {defineConfig} from "vitest/config";
export default defineConfig({test:{environment:"node",include:["apps/mobile/.generated/native-ui/apps/mobile/src/connection/storage.test.ts"],maxWorkers:1}});
