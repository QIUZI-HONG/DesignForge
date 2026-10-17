/**
 * 违规夹具（guard-vocab，登记面补漏）：`InstallGateMode` 是 license 三档的层内别名，
 * 此前未进登记面（code-review：B 半做），写死字面量联合无人管；登记后必须 exit 1 且点名。
 */
export type InstallGateMode = 'loadable' | 'view-only' | 'blocked';
