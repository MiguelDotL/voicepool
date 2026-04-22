const EL_BASE_URL = "https://api.elevenlabs.io/v1";

export interface ElevenLabsSubscription {
  tier: string;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix: number;
  status: string;
}

export interface ElevenLabsUserInfo {
  first_name: string;
  user_id: string;
  subscription: ElevenLabsSubscription;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

export interface SynthesizeParams {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  voiceSettings?: Record<string, unknown>;
  outputFormat?: string;
  signal?: AbortSignal;
}

export async function synthesize(params: SynthesizeParams): Promise<Buffer> {
  const { apiKey, voiceId, text, modelId = "eleven_v3", voiceSettings, outputFormat, signal } = params;

  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
  };
  if (voiceSettings) body.voice_settings = voiceSettings;
  if (outputFormat) body.output_format = outputFormat;

  const res = await fetch(
    `${EL_BASE_URL}/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    }
  );

  if (!res.ok) {
    if (res.status === 401) throw new ElevenLabsError("Invalid API key", 401);
    if (res.status === 422) throw new ElevenLabsError("Voice not available on this account", 422);
    if (res.status === 429) throw new ElevenLabsError("Rate limited by ElevenLabs API", 429);
    throw new ElevenLabsError(`ElevenLabs TTS error: ${res.status} ${res.statusText}`, res.status);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  if (buf.length < 1024) {
    throw new ElevenLabsError("ElevenLabs returned suspiciously small audio response", 502);
  }

  return buf;
}

/**
 * Fetch user info + subscription data from ElevenLabs for a given API key.
 * Uses /v1/user which includes both profile info and subscription details.
 */
export async function getUserInfo(
  apiKey: string
): Promise<ElevenLabsUserInfo> {
  const res = await fetch(`${EL_BASE_URL}/user`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new ElevenLabsError("Invalid API key", 401);
    }
    if (res.status === 429) {
      throw new ElevenLabsError("Rate limited by ElevenLabs API", 429);
    }
    throw new ElevenLabsError(
      `ElevenLabs API error: ${res.status} ${res.statusText}`,
      res.status
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const sub = data.subscription as Record<string, unknown>;

  return {
    first_name: (data.first_name as string) ?? "",
    user_id: (data.user_id as string) ?? "",
    subscription: {
      tier: sub.tier as string,
      character_count: sub.character_count as number,
      character_limit: sub.character_limit as number,
      next_character_count_reset_unix:
        sub.next_character_count_reset_unix as number,
      status: (sub.status as string) ?? "active",
    },
  };
}
