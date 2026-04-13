const EL_BASE_URL = "https://api.elevenlabs.io/v1";

export interface ElevenLabsSubscription {
  tier: string;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix: number;
  status: string;
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

/**
 * Fetch subscription/usage data from ElevenLabs for a given API key.
 */
export async function getSubscription(
  apiKey: string
): Promise<ElevenLabsSubscription> {
  const res = await fetch(`${EL_BASE_URL}/user/subscription`, {
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

  return {
    tier: data.tier as string,
    character_count: data.character_count as number,
    character_limit: data.character_limit as number,
    next_character_count_reset_unix:
      data.next_character_count_reset_unix as number,
    status: (data.status as string) ?? "active",
  };
}
