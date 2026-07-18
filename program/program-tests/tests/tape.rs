use anchor_lang::{InstructionData, ToAccountMetas};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    clock::Clock,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

const PROGRAM_ID: Pubkey = tape_program::ID;
const NOW: i64 = 1_800_000_000;
const WINDOW_START: i64 = NOW + 1_000;
const WINDOW_END: i64 = WINDOW_START + 30 * 86_400;

async fn setup() -> (ProgramTestContext, Keypair) {
    std::env::set_var(
        "SBF_OUT_DIR",
        concat!(env!("CARGO_MANIFEST_DIR"), "/../target/deploy"),
    );
    let pt = ProgramTest::new("tape_program", PROGRAM_ID, None);
    let mut ctx = pt.start_with_context().await;
    set_time(&mut ctx, NOW).await;
    let authority = ctx.payer.insecure_clone();
    (ctx, authority)
}

async fn set_time(ctx: &mut ProgramTestContext, ts: i64) {
    let mut clock: Clock = ctx.banks_client.get_sysvar().await.unwrap();
    clock.unix_timestamp = ts;
    ctx.set_sysvar(&clock);
}

async fn send(
    ctx: &mut ProgramTestContext,
    ixs: &[Instruction],
    extra: &[&Keypair],
) -> Result<(), String> {
    let payer = ctx.payer.insecure_clone();
    let mut signers: Vec<&Keypair> = vec![&payer];
    signers.extend_from_slice(extra);
    let recent = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &signers, recent);
    ctx.banks_client
        .process_transaction(tx)
        .await
        .map_err(|e| format!("{e:?}"))
}

fn strategy_pda(authority: &Pubkey, idx: u16) -> Pubkey {
    Pubkey::find_program_address(
        &[b"strategy", authority.as_ref(), &idx.to_le_bytes()],
        &PROGRAM_ID,
    )
    .0
}

fn commit_pda(strategy: &Pubkey, seq: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"commit", strategy.as_ref(), &seq.to_le_bytes()], &PROGRAM_ID).0
}

fn register_ix(authority: &Pubkey, idx: u16, window_start: i64) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: tape_program::accounts::RegisterStrategy {
            authority: *authority,
            strategy: strategy_pda(authority, idx),
            system_program: solana_sdk::system_program::id(),
        }
        .to_account_metas(None),
        data: tape_program::instruction::RegisterStrategy {
            strategy_idx: idx,
            params_hash: [7u8; 32],
            window_start,
            window_end: WINDOW_END,
            expected_signals_per_day: 12,
        }
        .data(),
    }
}

fn commit_ix(authority: &Pubkey, idx: u16, seq: u64, payload_hash: [u8; 32], deadline: i64) -> Instruction {
    let strategy = strategy_pda(authority, idx);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: tape_program::accounts::CommitSignal {
            authority: *authority,
            strategy,
            commitment: commit_pda(&strategy, seq),
            system_program: solana_sdk::system_program::id(),
        }
        .to_account_metas(None),
        data: tape_program::instruction::CommitSignal {
            payload_hash,
            fixture_id: 18_172_379,
            event_deadline: deadline,
        }
        .data(),
    }
}

fn reveal_ix(authority: &Pubkey, idx: u16, seq: u64, payload: Vec<u8>) -> Instruction {
    let strategy = strategy_pda(authority, idx);
    Instruction {
        program_id: PROGRAM_ID,
        accounts: tape_program::accounts::RevealSignal {
            authority: *authority,
            commitment: commit_pda(&strategy, seq),
            strategy,
        }
        .to_account_metas(None),
        data: tape_program::instruction::RevealSignal { payload }.data(),
    }
}

#[tokio::test]
async fn full_commit_reveal_lifecycle() {
    let (mut ctx, auth) = setup().await;
    send(&mut ctx, &[register_ix(&auth.pubkey(), 0, WINDOW_START)], &[])
        .await
        .unwrap();

    set_time(&mut ctx, WINDOW_START + 10).await;
    let payload = br#"{"fixture":18172379,"side":"home","edge_bps":140}"#.to_vec();
    let hash = solana_keccak_hasher::hash(&payload).to_bytes();
    send(
        &mut ctx,
        &[commit_ix(&auth.pubkey(), 0, 0, hash, WINDOW_START + 3_600)],
        &[],
    )
    .await
    .unwrap();

    set_time(&mut ctx, WINDOW_START + 4_000).await; // after the event
    send(&mut ctx, &[reveal_ix(&auth.pubkey(), 0, 0, payload)], &[])
        .await
        .unwrap();
}

#[tokio::test]
async fn registration_after_window_open_rejected() {
    let (mut ctx, auth) = setup().await;
    set_time(&mut ctx, WINDOW_START + 5).await;
    let err = send(&mut ctx, &[register_ix(&auth.pubkey(), 1, WINDOW_START)], &[])
        .await
        .unwrap_err();
    assert!(err.contains("Custom(6001)"), "WindowAlreadyOpen expected: {err}");
}

#[tokio::test]
async fn commit_after_event_deadline_rejected() {
    let (mut ctx, auth) = setup().await;
    send(&mut ctx, &[register_ix(&auth.pubkey(), 2, WINDOW_START)], &[])
        .await
        .unwrap();
    set_time(&mut ctx, WINDOW_START + 100).await;
    let err = send(
        &mut ctx,
        &[commit_ix(&auth.pubkey(), 2, 0, [1u8; 32], WINDOW_START + 50)],
        &[],
    )
    .await
    .unwrap_err();
    assert!(err.contains("Custom(6003)"), "TooLate expected: {err}");
}

#[tokio::test]
async fn tampered_reveal_rejected() {
    let (mut ctx, auth) = setup().await;
    send(&mut ctx, &[register_ix(&auth.pubkey(), 3, WINDOW_START)], &[])
        .await
        .unwrap();
    set_time(&mut ctx, WINDOW_START + 10).await;
    let honest = b"prediction: home wins".to_vec();
    let hash = solana_keccak_hasher::hash(&honest).to_bytes();
    send(
        &mut ctx,
        &[commit_ix(&auth.pubkey(), 3, 0, hash, WINDOW_START + 3_600)],
        &[],
    )
    .await
    .unwrap();

    // agent "improves" its call after the match — the tape says no
    let tampered = b"prediction: away wins (I always knew)".to_vec();
    let err = send(&mut ctx, &[reveal_ix(&auth.pubkey(), 3, 0, tampered)], &[])
        .await
        .unwrap_err();
    assert!(err.contains("Custom(6004)"), "HashMismatch expected: {err}");
}
