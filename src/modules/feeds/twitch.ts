import { fetchJson, HttpError } from '../../core/http.js';

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
}

export interface Stream {
  id: string;
  userId: string;
  login: string;
  displayName: string;
  title: string;
  game: string;
  startedAt: Date;
}

/** Twitch Helix API with an app access token, refreshed when it expires or is revoked. */
export class TwitchClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const params = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'client_credentials' });
    const data = await fetchJson<{ access_token: string; expires_in: number }>('https://id.twitch.tv/oauth2/token', { body: params });
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 120) * 1000 };
    return this.token.value;
  }

  private async helix<T>(path: string, params: URLSearchParams): Promise<T> {
    const call = async () =>
      fetchJson<T>(`https://api.twitch.tv/helix/${path}?${params.toString()}`, {
        headers: { 'client-id': this.clientId, authorization: `Bearer ${await this.accessToken()}` },
      });
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 401) throw err;
      this.token = null;
      return call();
    }
  }

  async userByLogin(login: string): Promise<TwitchUser | null> {
    const data = await this.helix<{ data: { id: string; login: string; display_name: string }[] }>('users', new URLSearchParams({ login }));
    const user = data.data[0];
    return user ? { id: user.id, login: user.login, displayName: user.display_name } : null;
  }

  /** Live streams for the given user IDs, keyed by user ID. */
  async liveStreams(userIds: readonly string[]): Promise<Map<string, Stream>> {
    const live = new Map<string, Stream>();
    // Helix takes at most 100 IDs per request.
    for (let i = 0; i < userIds.length; i += 100) {
      const params = new URLSearchParams(userIds.slice(i, i + 100).map((id): [string, string] => ['user_id', id]));
      params.set('first', '100');
      const data = await this.helix<{
        data: { id: string; user_id: string; user_login: string; user_name: string; title: string; game_name: string; started_at: string; type: string }[];
      }>('streams', params);
      for (const s of data.data) {
        if (s.type !== 'live') continue;
        live.set(s.user_id, {
          id: s.id,
          userId: s.user_id,
          login: s.user_login,
          displayName: s.user_name,
          title: s.title,
          game: s.game_name,
          startedAt: new Date(s.started_at),
        });
      }
    }
    return live;
  }
}

/** Accepts "name", "@name" or a twitch.tv link. */
export function parseTwitchLogin(input: string): string | null {
  const match = /^(?:https?:\/\/)?(?:www\.)?(?:twitch\.tv\/)?@?([a-z0-9_]{3,25})\/?$/i.exec(input.trim());
  return match ? match[1]!.toLowerCase() : null;
}
