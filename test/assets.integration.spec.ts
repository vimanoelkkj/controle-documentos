import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/server/worker";

describe("entrega dos assets", () => {
  it.each(["/", "/favicon.ico"])(
    "encaminha %s sem exigir usuário ou período",
    async (pathname) => {
      const respostaAsset = new Response(`asset:${pathname}`, { status: 200 });
      const fetchAsset = vi.fn(async () => respostaAsset);
      const env = {
        ASSETS: { fetch: fetchAsset },
      } as unknown as Env;
      const request = new Request(`https://controle-documentos.test${pathname}`);

      const response = await worker.fetch(request, env);

      expect(fetchAsset).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(`asset:${pathname}`);
    },
  );
});
