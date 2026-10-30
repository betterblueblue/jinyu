import { readIndex, writeBaseline } from "./test-data";

/** 跑之前记下 data/index.json 里已有的报告 id，供 teardown 比对 */
export default function globalSetup(): void {
  writeBaseline(readIndex().map((i) => i.id));
}
