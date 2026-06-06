// Thin typed client for the Colorex broker (rgb-rfq `rfq-api`). Mirrors the
// taker side of `rfq-client`. The broker routes quote/accept/sign to a maker;
// the maker builds + broadcasts the atomic BTC↔RGB swap — see docs/swap-flow.md.
//
// Endpoints (verify in docs/colorex-broker-api.md):
//   POST /rfq                       CreateRfqRequest      → Quote[]
//   POST /quotes/:id/accept         AcceptQuoteRequest    → SettlementIntent
//   POST /quotes/:id/consignment    { consignment }       → SettlementIntent  (sell side)
//   POST /quotes/:id/sign           { psbt }              → SettlementIntent

import type {
  AcceptQuoteRequest,
  CreateRfqRequest,
  Quote,
  SettlementIntent,
} from './types'

export class ColorexClient {
  constructor(private readonly baseUrl: string) {}

  async requestQuotes(req: CreateRfqRequest): Promise<Quote[]> {
    return this.post('/rfq', req)
  }

  async acceptQuote(quoteId: string, req: AcceptQuoteRequest): Promise<SettlementIntent> {
    return this.post(`/quotes/${encodeURIComponent(quoteId)}/accept`, req)
  }

  async submitConsignment(quoteId: string, consignment: string): Promise<SettlementIntent> {
    return this.post(`/quotes/${encodeURIComponent(quoteId)}/consignment`, { consignment })
  }

  async submitSignedPsbt(quoteId: string, psbt: string): Promise<SettlementIntent> {
    return this.post(`/quotes/${encodeURIComponent(quoteId)}/sign`, { psbt })
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`colorex ${path} → ${res.status}: ${text}`)
    }
    return (await res.json()) as T
  }
}
