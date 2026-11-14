"""Stak image generator. Reads JSON from stdin:
{"prompt": str, "aspect": "16:9|4:3|1:1|3:4|9:16", "model": str, "out": "/abs/path.jpg", "maxw": 1600}
Writes an optimised JPEG to `out` and prints JSON {"ok": true, "bytes": n} (or {"ok": false, "error": "..."})."""
import asyncio, base64, io, json, sys

async def main():
    req = json.loads(sys.stdin.read() or "{}")
    from pplx.python.sdks.llm_api import (Client, Conversation, Identity, ImageGenAspectRatio, ImageGenParams,
        ImageGenQuality, LLMAPIClient, MediaGenParams, SamplingParams, TextBlock)
    ar = {"1:1": ImageGenAspectRatio.RATIO_1_1, "3:4": ImageGenAspectRatio.RATIO_3_4, "4:3": ImageGenAspectRatio.RATIO_4_3,
          "9:16": ImageGenAspectRatio.RATIO_9_16, "16:9": ImageGenAspectRatio.RATIO_16_9}
    convo = Conversation()
    convo.add_user([TextBlock(text=req["prompt"])])
    result = await LLMAPIClient().messages.create(
        model=req.get("model") or "nano_banana_2", convo=convo,
        identity=Identity(client=Client.ASI, use_case="webserver_image_gen"),
        sampling_params=SamplingParams(max_tokens=1),
        media_gen_params=MediaGenParams(image=ImageGenParams(number_of_images=1,
            aspect_ratio=ar.get(req.get("aspect"), ImageGenAspectRatio.RATIO_4_3), quality=ImageGenQuality.HIGH)),
    )
    if not result.images:
        raise RuntimeError("No image generated")
    raw = base64.b64decode(result.images[0].b64_data)
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        mw = int(req.get("maxw") or 1600)
        if im.width > mw:
            im = im.resize((mw, round(im.height * mw / im.width)), Image.LANCZOS)
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=84, optimize=True, progressive=True); raw = buf.getvalue()
    except ImportError:
        pass
    with open(req["out"], "wb") as f:
        f.write(raw)
    print(json.dumps({"ok": True, "bytes": len(raw)}))

try:
    asyncio.run(main())
except Exception as e:  # report, never crash the caller
    print(json.dumps({"ok": False, "error": str(e)[:300]}))
