/************************************
 * SALES ORDER — ITEM-LEVEL CLOSE
 *
 * Status → Close Items / Re-open Items on a submitted Sales Order.
 * Server side: export/api/so_item_close.py
 ************************************/
frappe.ui.form.on("Sales Order", {
    refresh(frm) {
        setup_item_close_buttons(frm);
        mark_closed_item_rows(frm);
    },
});

frappe.ui.form.on("Sales Order Item", {
    // Ticking / unticking "Item Closed" on a submitted order is applied on Update
    // (server: before_sales_order_update in export/api/so_item_close.py)
    custom_item_closed(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (frm.doc.docstatus !== 1 || !is_item_closed(row)) return;

        let message = null;
        if (frm.doc.status === "Closed") {
            message = __("Sales Order is Closed. Re-open the Sales Order first.");
        } else if (!(flt(row.delivered_qty) < flt(row.qty) || flt(row.billed_amt) < flt(row.amount))) {
            message = __("Row #{0}: Item {1} is already fully delivered and billed.", [row.idx, row.item_code]);
        }

        if (message) {
            frappe.model.set_value(cdt, cdn, "custom_item_closed", 0);
            frappe.msgprint(message);
        }
    },
});

function is_item_closed(row) {
    return cint(row.custom_item_closed) === 1;
}

function can_close_item(row) {
    // Same condition as the standard Close button, applied to one row
    return !is_item_closed(row)
        && (flt(row.delivered_qty) < flt(row.qty) || flt(row.billed_amt) < flt(row.amount));
}

function setup_item_close_buttons(frm) {
    const doc = frm.doc;
    if (doc.docstatus !== 1 || ["Closed", "Completed"].includes(doc.status) || !frm.has_perm("submit")) {
        return;
    }

    const rows = doc.items || [];
    if (rows.some(can_close_item)) {
        frm.add_custom_button(__("Close Items"), () => show_item_close_dialog(frm, "close"), __("Status"));
    }
    if (rows.some(is_item_closed)) {
        frm.add_custom_button(__("Re-open Items"), () => show_item_close_dialog(frm, "reopen"), __("Status"));
    }
}

function show_item_close_dialog(frm, action) {
    const closing = action === "close";
    const data = (frm.doc.items || [])
        .filter(closing ? can_close_item : is_item_closed)
        .map((row) => ({
            so_item: row.name,
            row_no: row.idx,
            item_code: row.item_code,
            qty: row.qty,
            delivered_qty: row.delivered_qty,
            closing_qty: closing ? Math.max(flt(row.qty) - flt(row.delivered_qty), 0) : flt(row.custom_closed_qty),
            closed_by: row.custom_closed_by,
        }));

    const fields = [
        { fieldname: "row_no", fieldtype: "Int", label: __("Row"), read_only: 1, in_list_view: 1, columns: 1 },
        { fieldname: "item_code", fieldtype: "Data", label: __("Item"), read_only: 1, in_list_view: 1, columns: 3 },
        { fieldname: "qty", fieldtype: "Float", label: __("Qty"), read_only: 1, in_list_view: 1, columns: 1 },
        { fieldname: "delivered_qty", fieldtype: "Float", label: __("Delivered"), read_only: 1, in_list_view: 1, columns: 1 },
        {
            fieldname: "closing_qty",
            fieldtype: "Float",
            label: closing ? __("Qty to Close") : __("Closed Qty"),
            read_only: 1,
            in_list_view: 1,
            columns: 2,
        },
        { fieldname: "so_item", fieldtype: "Data", hidden: 1 },
    ];
    if (!closing) {
        fields.splice(5, 0, {
            fieldname: "closed_by", fieldtype: "Data", label: __("Closed By"), read_only: 1, in_list_view: 1, columns: 2,
        });
    }

    const dialog = new frappe.ui.Dialog({
        title: closing ? __("Close Items") : __("Re-open Items"),
        size: "large",
        fields: [
            {
                fieldtype: "HTML",
                options: `<p class="text-muted small">${closing
                    ? __("Selected items can no longer be delivered, invoiced or ordered, and their undelivered qty is released from reserved stock — the same as closing the whole Sales Order, but only for these rows.")
                    : __("Selected items become open again: their pending qty is reserved again and they can be delivered and invoiced.")}</p>`,
            },
            {
                fieldname: "items",
                fieldtype: "Table",
                label: __("Items"),
                cannot_add_rows: true,
                cannot_delete_rows: true,
                in_place_edit: false,
                data: data,
                fields: fields,
            },
        ],
        primary_action_label: closing ? __("Close Selected Items") : __("Re-open Selected Items"),
        primary_action() {
            const selected = dialog.fields_dict.items.grid.get_selected_children();
            if (!selected.length) {
                frappe.msgprint(__("Please select at least one item."));
                return;
            }

            frappe.call({
                method: closing
                    ? "export.api.so_item_close.close_items"
                    : "export.api.so_item_close.reopen_items",
                args: { sales_order: frm.doc.name, items: selected.map((row) => row.so_item) },
                freeze: true,
                callback(r) {
                    if (r.exc) return;
                    dialog.hide();
                    frm.reload_doc();
                },
            });
        },
    });
    dialog.show();
}

function mark_closed_item_rows(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    if (!document.getElementById("gme-item-close-style")) {
        $(`<style id="gme-item-close-style">
            .grid-row.gme-item-closed > .data-row { background: var(--bg-red, #fff5f5); box-shadow: inset 3px 0 0 var(--red-500, #e03636); }
            .grid-row.gme-item-closed > .data-row .static-area { opacity: 0.65; }
        </style>`).appendTo("head");
    }

    const mark = () => {
        (grid.grid_rows || []).forEach((row) => {
            const closed = row?.doc && is_item_closed(row.doc);
            row.wrapper
                .toggleClass("gme-item-closed", !!closed)
                .attr("title", closed ? __("Item closed") : null);
        });
    };

    // Grid can re-render after refresh/reset, so defer once
    setTimeout(mark, 0);
}
