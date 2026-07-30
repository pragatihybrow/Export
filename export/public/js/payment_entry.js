/************************************
 * PAYMENT ENTRY — SPLIT EXCHANGE GAIN/LOSS ACROSS ACCOUNTS
 *
 * Core ERPNext always forces the row flagged "is_exchange_gain_loss" to the
 * FULL Paid/Received difference on every recalculation. This mirrors the
 * server-side adjustment (export.api.payment_entry._apply_exchange_gain_loss_split)
 * on the client side too, so the UI doesn't show a stale "full amount" that
 * only corrects itself after save.
 *
 * Usage: on a row with a difference already showing in the auto-created
 * Exchange Gain/Loss row, add another deduction row with the desired
 * account, enter the amount you want carved out, and check "Split of
 * Exchange Gain/Loss" on that row. The Exchange Gain/Loss row's amount
 * will automatically shrink by that much.
 ************************************/
frappe.ui.form.on("Payment Entry", {
    refresh(frm) {
        apply_exchange_gain_loss_split(frm);
    },

    base_paid_amount(frm) {
        setTimeout(() => apply_exchange_gain_loss_split(frm), 300);
    },

    base_received_amount(frm) {
        setTimeout(() => apply_exchange_gain_loss_split(frm), 300);
    },
});

frappe.ui.form.on("Payment Entry Deduction", {
    amount(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row.is_exchange_gain_loss) return; // avoid reacting to our own adjustment below
        apply_exchange_gain_loss_split(frm);
    },

    custom_split_of_exchange_gain_loss(frm, cdt, cdn) {
        apply_exchange_gain_loss_split(frm);
    },

    deductions_remove(frm) {
        apply_exchange_gain_loss_split(frm);
    },
});

function apply_exchange_gain_loss_split(frm) {
    const rows = frm.doc.deductions || [];
    const exchange_row = rows.find((d) => d.is_exchange_gain_loss);
    if (!exchange_row) return;

    const split_rows = rows.filter((d) => d.custom_split_of_exchange_gain_loss && !d.is_exchange_gain_loss);
    if (!split_rows.length) return;

    const split_total = split_rows.reduce((sum, d) => sum + flt(d.amount), 0);
    if (!split_total) return;

    // Core's own logic resets this row to the FULL paid/received difference on
    // every recalculation, so re-derive from the raw difference each time,
    // not from whatever the row currently shows.
    const full_difference = flt(frm.doc.base_paid_amount) - flt(frm.doc.base_received_amount);
    const remaining = flt(full_difference - split_total, precision("amount", exchange_row));

    if (remaining < 0) {
        frappe.show_alert({
            message: __("Split amount exceeds the total Exchange Gain/Loss — it will be corrected on save."),
            indicator: "red",
        });
        return;
    }

    if (flt(exchange_row.amount) === remaining) return; // already correct, avoid a needless refresh

    frappe.model.set_value(exchange_row.doctype, exchange_row.name, "amount", remaining);
    frm.trigger("set_difference_amount");
}
