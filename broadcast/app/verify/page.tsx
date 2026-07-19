import { meta } from "../../lib/data";
import { Nav } from "../../components/bits";

export default function Verify() {
  const m = meta();

  return (
    <div className="sheet">
      <header className="masthead">
        <div className="mast-eyebrow">don&apos;t take the broadcast&apos;s word for it</div>
        <h1 className="mast-title">VERIFY IT</h1>
        <hr className="rule-heavy" />
        <Nav current="verify" />
      </header>

      <section className="sect prose" aria-label="judge path">
        <p>
          The Pit&apos;s claim is narrow and checkable: <strong>every pick was sealed on-chain
          before its deadline, and no revealed pick differs from what was sealed.</strong> The
          broadcast is decoration; the registry is the product. Here is the whole audit, no
          credentials required:
        </p>

        <h3>1 · Run the verifier</h3>
        <div className="cmd">git clone &lt;this repo&gt; &amp;&amp; cd the-pit{"\n"}npm install{"\n"}npx tsx scripts/verify.ts</div>
        <p>
          It talks to a public devnet RPC, enumerates every Strategy and Commitment account on
          the registry program, decodes the raw bytes, and prints a PASS/FAIL table. No API
          keys, no env vars, under three minutes.
        </p>
        <p>
          Only want to check the one slip in front of you? Every sealed slip on the bill carries
          its own copy-paste line — <code>npx tsx scripts/verify.ts --commitment &lt;account&gt;</code>{" "}
          audits that single commitment and nothing else. Same zero credentials.
        </p>

        <h3>2 · What the program enforces</h3>
        <ol>
          <li>
            <strong>Registration precedes the window.</strong> A strategy&apos;s parameter hash and
            cadence promise are fixed before it may commit a single pick.
          </li>
          <li>
            <strong>Commits precede deadlines.</strong> <code>commit_signal</code> rejects any
            commitment whose clock is at or past its event deadline. The main event&apos;s picks
            were sealed roughly twenty hours before kickoff — the account&apos;s{" "}
            <code>committed_at</code> is set by the chain&apos;s clock, not ours.
          </li>
          <li>
            <strong>Reveals must match.</strong> <code>reveal_signal</code> recomputes
            keccak256 of the submitted payload on-chain and rejects a mismatch. There is no
            instruction to edit or delete a commitment. Hiding a bad call is impossible;
            it just stays sealed and unrevealed, which the cadence meter counts against you.
          </li>
        </ol>

        <h3>3 · What it cannot enforce</h3>
        <p>
          The program cannot check <em>how</em> a pick was computed — the engines run
          off-chain (TEE attestation is the honest roadmap answer, not a claim we make
          today). It cannot stop someone registering many strategies and promoting the lucky
          one — but registration is public, cadence promises are public, and an abandoned
          sibling strategy is visible forever. Replay rounds are labelled REPLAY: their
          commitments were sealed after the matches ended, as their on-chain timestamps
          plainly show. Only the main event was sealed before its own kickoff.
        </p>

        <h3>4 · The accounts</h3>
        <p>
          Registry program: <a href={m.programLink}>{m.programId}</a>
        </p>
        <ol>
          {m.personas.map((p) =>
            p.strategyLink ? (
              <li key={p.id}>
                {p.name}: <a href={p.strategyLink}>{p.strategyAddress}</a>
                <br />
                <code style={{ fontSize: 12 }}>{p.params}</code> — keccak of this exact string
                is the on-chain <code>params_hash</code>; the verifier recomputes it.
              </li>
            ) : null
          )}
        </ol>
        <p>
          All evidence links are <em>account</em> links (devnet purges transaction history in
          days; accounts persist). Raw transaction JSON is archived in{" "}
          <code>evidence/tx/</code> in the repo.
        </p>

        <h3>5 · The pre-season</h3>
        <p>
          This registry wasn&apos;t deployed for tonight. Two earlier strategies have been
          committing odds-dislocation signals to the same program since early July — the
          verifier lists them as hash-only entries (their payloads live in the older
          repo). The mechanics you&apos;re auditing tonight have a month of history.
        </p>
      </section>

      <footer className="smallprint">
        <span>Solana devnet · no money, only reputations</span>
        <span>
          <a href="/">back to the bill</a>
        </span>
      </footer>
    </div>
  );
}
