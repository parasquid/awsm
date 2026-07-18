import { browser } from "wxt/browser";
import type { RuntimeErrorId } from "../domain/contracts";
import type { AppRequest, AppResponse } from "./protocol";

export class AppClientError extends Error {
  readonly id: RuntimeErrorId;

  constructor(id: RuntimeErrorId, message: string) {
    super(message);
    this.name = "AppClientError";
    this.id = id;
  }
}

export async function sendRequest<T>(request: AppRequest): Promise<T> {
  const response: AppResponse = await browser.runtime.sendMessage(request);
  if (!response.ok) throw new AppClientError(response.error.id, response.error.message);
  return response.value as T;
}
