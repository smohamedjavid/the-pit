use anchor_lang::prelude::*;

declare_id!("8GcrsgwxH4p4DzdBimyApwMex1DRwve8j3XiMWN9WbaD");

/// The Tape: a tamper-proof public record for forecasting agents.
///
/// Survivorship bias dies here by construction:
/// 1. A strategy registers BEFORE its window: params hash + expected cadence.
/// 2. Every signal is committed (hash only) BEFORE the event it predicts.
/// 3. After the event, the signal is revealed and must match its hash.
/// Gaps between expected and actual cadence are computable by anyone — a
/// strategy that only "publishes the winners" convicts itself on-chain.
#[program]
pub mod tape_program {
    use super::*;

    pub fn register_strategy(
        ctx: Context<RegisterStrategy>,
        strategy_idx: u16,
        params_hash: [u8; 32],
        window_start: i64,
        window_end: i64,
        expected_signals_per_day: u16,
    ) -> Result<()> {
        require!(window_start < window_end, TapeError::BadWindow);
        let clock = Clock::get()?;
        // The whole point: registration precedes the window it claims.
        require!(clock.unix_timestamp <= window_start, TapeError::WindowAlreadyOpen);

        let s = &mut ctx.accounts.strategy;
        s.authority = ctx.accounts.authority.key();
        s.strategy_idx = strategy_idx;
        s.params_hash = params_hash;
        s.window_start = window_start;
        s.window_end = window_end;
        s.expected_signals_per_day = expected_signals_per_day;
        s.signal_count = 0;
        s.bump = ctx.bumps.strategy;
        Ok(())
    }

    pub fn commit_signal(
        ctx: Context<CommitSignal>,
        payload_hash: [u8; 32],
        fixture_id: u64,
        event_deadline: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let s = &mut ctx.accounts.strategy;
        require!(
            clock.unix_timestamp >= s.window_start && clock.unix_timestamp <= s.window_end,
            TapeError::OutsideWindow
        );
        // A commitment after its event is worthless — enforce priority.
        require!(clock.unix_timestamp < event_deadline, TapeError::TooLate);

        let c = &mut ctx.accounts.commitment;
        c.strategy = s.key();
        c.seq = s.signal_count;
        c.payload_hash = payload_hash;
        c.fixture_id = fixture_id;
        c.event_deadline = event_deadline;
        c.committed_at = clock.unix_timestamp;
        c.committed_slot = clock.slot;
        c.revealed = false;
        c.bump = ctx.bumps.commitment;

        s.signal_count = s.signal_count.checked_add(1).ok_or(TapeError::Overflow)?;
        Ok(())
    }

    /// Reveal after the event: payload must hash to the commitment.
    /// The payload itself lives off-chain (dashboard hosts it); only its
    /// keccak identity is checked here.
    pub fn reveal_signal(ctx: Context<RevealSignal>, payload: Vec<u8>) -> Result<()> {
        let c = &mut ctx.accounts.commitment;
        require!(!c.revealed, TapeError::AlreadyRevealed);
        let hash = solana_keccak_hasher::hash(&payload);
        require!(hash.to_bytes() == c.payload_hash, TapeError::HashMismatch);
        c.revealed = true;
        emit!(SignalRevealed {
            commitment: c.key(),
            strategy: c.strategy,
            seq: c.seq,
            fixture_id: c.fixture_id,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(strategy_idx: u16)]
pub struct RegisterStrategy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Strategy::SPACE,
        seeds = [b"strategy", authority.key().as_ref(), &strategy_idx.to_le_bytes()],
        bump
    )]
    pub strategy: Account<'info, Strategy>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitSignal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"strategy", authority.key().as_ref(), &strategy.strategy_idx.to_le_bytes()],
        bump = strategy.bump,
        constraint = strategy.authority == authority.key() @ TapeError::WrongAuthority
    )]
    pub strategy: Account<'info, Strategy>,
    #[account(
        init,
        payer = authority,
        space = Commitment::SPACE,
        seeds = [b"commit", strategy.key().as_ref(), &strategy.signal_count.to_le_bytes()],
        bump
    )]
    pub commitment: Account<'info, Commitment>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealSignal<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = commitment.strategy == strategy.key() @ TapeError::WrongAuthority
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(constraint = strategy.authority == authority.key() @ TapeError::WrongAuthority)]
    pub strategy: Account<'info, Strategy>,
}

#[account]
pub struct Strategy {
    pub authority: Pubkey,
    pub strategy_idx: u16,
    /// keccak256 of the full parameter set — immutable for the window.
    pub params_hash: [u8; 32],
    pub window_start: i64,
    pub window_end: i64,
    /// Cadence promise: the anti-cherry-picking baseline.
    pub expected_signals_per_day: u16,
    pub signal_count: u64,
    pub bump: u8,
}

impl Strategy {
    pub const SPACE: usize = 8 + 32 + 2 + 32 + 8 + 8 + 2 + 8 + 1;
}

#[account]
pub struct Commitment {
    pub strategy: Pubkey,
    pub seq: u64,
    pub payload_hash: [u8; 32],
    pub fixture_id: u64,
    pub event_deadline: i64,
    pub committed_at: i64,
    pub committed_slot: u64,
    pub revealed: bool,
    pub bump: u8,
}

impl Commitment {
    pub const SPACE: usize = 8 + 32 + 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[event]
pub struct SignalRevealed {
    pub commitment: Pubkey,
    pub strategy: Pubkey,
    pub seq: u64,
    pub fixture_id: u64,
}

#[error_code]
pub enum TapeError {
    #[msg("Window start must precede end")]
    BadWindow,
    #[msg("Registration must happen before the window opens")]
    WindowAlreadyOpen,
    #[msg("Strategy window is not open")]
    OutsideWindow,
    #[msg("Cannot commit after the event deadline")]
    TooLate,
    #[msg("Reveal does not match the committed hash")]
    HashMismatch,
    #[msg("Commitment already revealed")]
    AlreadyRevealed,
    #[msg("Wrong authority")]
    WrongAuthority,
    #[msg("Arithmetic overflow")]
    Overflow,
}
