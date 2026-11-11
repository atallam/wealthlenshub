import { randomUUID } from "crypto";

export const err = (msg, status, extra = {}) => Object.assign(new Error(msg), { status, extra });

export const stId = () => "bst_" + randomUUID().replace(/-/g, "").slice(0, 16);

export const txId = () => "btx_" + randomUUID().replace(/-/g, "").slice(0, 16);

export const aliasId = () => "baa_" + randomUUID().replace(/-/g, "").slice(0, 16);

export const catLimitId = () => "bcl_" + randomUUID().replace(/-/g, "").slice(0, 16);
