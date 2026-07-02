frappe.ui.form.on("Journal Entry", {
    setup(frm) {
        frm.set_query("custom_journal_entry", "accounts", function (doc, cdt, cdn) {
            var row = frappe.get_doc(cdt, cdn);
            frappe.model.validate_missing(row, "account");
            return {
                query: "export.api.journal_entry.get_against_jv",
                filters: {
                    account: row.account,
                    party: row.party,
                },
            };
        });

    }
});

// Registered reactively (on the row's reference_type/party change) rather than in
// setup(), because ERPNext core wires its own reference_name query via a class-based
// controller (cur_frm.script_manager.make(erpnext.accounts.JournalEntry) in
// erpnext's journal_entry.js) that runs after plain frappe.ui.form.on("setup")
// handlers and silently re-overwrites frm.set_query("reference_name", ...). Setting
// it here, after the user actually picks a reference_type, guarantees ours is the
// last one registered. Every branch below except "Exchange Rate Revaluation" mirrors
// core's logic as-is; that branch is added because party/party_type live on the
// Exchange Rate Revaluation Account child table, not on the parent, so core never
// filters it by party.
function set_reference_name_query(frm) {
    frm.set_query("reference_name", "accounts", function (doc, cdt, cdn) {
        var jvd = frappe.get_doc(cdt, cdn);

        if (jvd.reference_type === "Journal Entry") {
            frappe.model.validate_missing(jvd, "account");
            return {
                query: "erpnext.accounts.doctype.journal_entry.journal_entry.get_against_jv",
                filters: {
                    account: jvd.account,
                    party: jvd.party,
                },
            };
        }

        if (jvd.reference_type === "Exchange Rate Revaluation") {
            var err_filters = [["Exchange Rate Revaluation", "docstatus", "=", 1]];
            if (jvd.party) {
                err_filters.push(["Exchange Rate Revaluation Account", "party", "=", jvd.party]);
            }
            return { filters: err_filters };
        }

        var out = {
            filters: [[jvd.reference_type, "docstatus", "=", 1]],
        };

        if (["Sales Invoice", "Purchase Invoice"].includes(jvd.reference_type)) {
            out.filters.push([jvd.reference_type, "outstanding_amount", "!=", 0]);
            if (jvd.cost_center) {
                out.filters.push([jvd.reference_type, "cost_center", "in", ["", jvd.cost_center]]);
            }
            frappe.model.validate_missing(jvd, "account");
            var party_account_field = jvd.reference_type === "Sales Invoice" ? "debit_to" : "credit_to";
            out.filters.push([jvd.reference_type, party_account_field, "=", jvd.account]);
        }

        if (["Sales Order", "Purchase Order"].includes(jvd.reference_type)) {
            frappe.model.validate_missing(jvd, "party_type");
            frappe.model.validate_missing(jvd, "party");
            out.filters.push([jvd.reference_type, "per_billed", "<", 100]);
        }

        if (jvd.party_type && jvd.party) {
            let party_field = "";
            if (jvd.reference_type.indexOf("Sales") === 0) {
                party_field = "customer";
            } else if (jvd.reference_type.indexOf("Purchase") === 0) {
                party_field = "supplier";
            }
            if (party_field) {
                out.filters.push([jvd.reference_type, party_field, "=", jvd.party]);
            }
        }

        return out;
    });
}

frappe.ui.form.on("Journal Entry Account", {
    custom_journal_entry(frm, cdt, cdn) {
        var row = frappe.get_doc(cdt, cdn);
        if (row.custom_journal_entry && row.reference_type === "Journal Entry") {
            frappe.model.set_value(cdt, cdn, "reference_name", row.custom_journal_entry);
        } else {
            frappe.model.set_value(cdt, cdn, "reference_name", "");
        }
    },

    reference_type(frm, cdt, cdn) {
        var row = frappe.get_doc(cdt, cdn);
        if (row.reference_type !== "Journal Entry") {
            frappe.model.set_value(cdt, cdn, "custom_journal_entry", "");
        }
        set_reference_name_query(frm);
    },

    party(frm, cdt, cdn) {
        set_reference_name_query(frm);
    }
});
