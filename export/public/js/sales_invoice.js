/************************************
 * SALES INVOICE (PARENT)
 ************************************/
frappe.ui.form.on("Sales Invoice", {
    refresh(frm) {
        toggle_export_fields(frm);
        toggle_cif_total_by_currency(frm);
        toggle_sub_items_columns(frm);
        hide_items_rows(frm);
        // recalculate_si_totals(frm);

        setup_items_grid_template_buttons(frm);
        setup_sub_items_grid_template_buttons(frm);

        // Commercial Invoice PDF download — only for saved Export orders
        if (!frm.is_new() && frm.doc.custom_order_type === "Export") {
            frm.add_custom_button(__("Commercial Invoice PDF"), function () {
                const url = frappe.urllib.get_full_url(
                    "/api/method/export.api.pdf.download_commercial_invoice_pdf?name=" +
                    encodeURIComponent(frm.doc.name)
                );
                window.open(url, "_blank");
            }, __("Print"));
        }

        // Sub-items table configuration (only if field exists)
        if (frm.fields_dict.custom_sub_items) {
            frm.fields_dict.custom_sub_items.grid.cannot_add_rows = true;

            // Set fields as read-only, checking if they exist first
            const readonly_fields = ['parent_item', 'parent_item_name', 'sub_item_code', 'sub_item_name'];
            readonly_fields.forEach(function(fieldname) {
                if (frm.fields_dict.custom_sub_items.grid.docfields.find(f => f.fieldname === fieldname)) {
                    frm.fields_dict.custom_sub_items.grid.update_docfield_property(fieldname, 'read_only', 1);
                }
            });

            frm.refresh_field('custom_sub_items');
        }
    },

    custom_order_type(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);
        calculate_si_cif_totals(frm);
    },

    currency(frm) {
        toggle_cif_total_by_currency(frm);
        calculate_si_cif_totals(frm);
    },

    conversion_rate(frm) {
        // Re-run the full totals function so rounding error is computed
        // from freshly summed locals — not from stale frm.doc values.
        calculate_si_cif_totals(frm);
        update_base_rate_for_all_items(frm);
    },

    validate(frm) {
        // Recalculate CIF for all items rows (covers template uploads where field triggers don't fire)
        if (frm.doc.custom_order_type === "Export") {
            (frm.doc.items || []).forEach(row => {
                calculate_cif_values(frm, row.doctype, row.name);
            });
        }

        // Recalculate all sub-item values first
        if (frm.doc.custom_sub_items) {
            frm.doc.custom_sub_items.forEach(row => {
                calculate_sub_item_cif_values(frm, 'Sales Invoice Sub Items', row.name);
            });
        }

        apply_parent_values_from_sub_items(frm);
        calculate_si_cif_totals(frm);
        // recalculate_si_totals(frm);

        // Add Bank Charges item at the end when order type is Export
        // Commented out: reverting CIF difference adjustment via Bank Charges
        // if (frm.doc.custom_order_type === "Export") {
        //     add_bank_charges_item(frm);
        //     hide_items_rows(frm);
        // }

        frm.refresh_field("custom_sub_items");
    },

    onload_post_render(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);
        carry_forward_sub_items(frm);
        hide_items_rows(frm);
    }
});

/************************************
 * ITEMS TEMPLATE BUTTONS (items grid)
 ************************************/
function _hide_standard_items_template_buttons(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;
    const $wrapper = $(grid.wrapper);
    $wrapper.find('.grid-download, .grid-upload').hide();
    $wrapper.find('[data-label="Download"], [data-label="Upload"]')
        .closest('li').hide();
}

function setup_items_grid_template_buttons(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('si-items-grid-custom')) {
        $wrapper.addClass('si-items-grid-custom');
        if (!$('#si-items-grid-custom-style').length) {
            $('<style id="si-items-grid-custom-style">' +
              '.si-items-grid-custom .grid-download,' +
              '.si-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    _hide_standard_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-si-template-btns').length) return;

        const $custom = $('<div class="custom-si-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Template'))
                .on('click', () => {
                    const si = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.si_items_template.get_si_items_template'
                        + (si ? `?sales_invoice=${si}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Sales Invoice before uploading.'));
                        return;
                    }
                    show_items_upload_dialog(frm);
                })
        );

        const $downloadBtn = $wrapper.find('.grid-download');
        if ($downloadBtn.length && !$downloadBtn.parent().is($footer)) {
            // download button is inside a right-side wrapper div — inject alongside it
            $downloadBtn.parent().append($custom);
        } else {
            // no download button, or it is a direct child of the footer flex container —
            // use margin-left:auto to pin our buttons to the right edge
            $custom.css('margin-left', 'auto');
            ($footer.length ? $footer : $wrapper).append($custom);
        }
    }, 400);
}

function show_items_upload_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __('Upload Items Template'),
        fields: [
            {
                label: __('File (.xlsx or .csv)'),
                fieldname: 'template_file',
                fieldtype: 'Attach',
                reqd: 1,
                description: __(
                    'Upload the filled items template. ' +
                    'Row 1 = labels, Row 2 = fieldnames, Row 3+ = data. ' +
                    'Each row needs item_code.'
                )
            }
        ],
        primary_action_label: __('Import'),
        primary_action(values) {
            if (!values.template_file) {
                frappe.msgprint(__('Please attach a file first.'));
                return;
            }
            const ext = values.template_file.split('.').pop().toLowerCase();
            if (!['xlsx', 'csv'].includes(ext)) {
                frappe.msgprint(__('Only .xlsx and .csv files are supported.'));
                return;
            }

            d.set_df_property('template_file', 'read_only', 1);
            d.get_primary_btn().prop('disabled', true).text(__('Importing…'));

            frappe.call({
                method: 'export.api.si_items_template.import_si_items',
                args: {
                    sales_invoice: frm.doc.name,
                    file_url: values.template_file
                },
                callback(r) {
                    d.hide();
                    if (r.message) {
                        frappe.show_alert({
                            message: __(r.message.message),
                            indicator: 'green'
                        }, 6);
                        frm.reload_doc();
                    }
                },
                error() {
                    d.set_df_property('template_file', 'read_only', 0);
                    d.get_primary_btn().prop('disabled', false).text(__('Import'));
                }
            });
        }
    });
    d.show();
}


/************************************
 * SUB-ITEMS TEMPLATE BUTTONS (custom_sub_items grid)
 ************************************/
function _hide_standard_sub_items_template_buttons(frm) {
    const grid = frm.fields_dict?.custom_sub_items?.grid;
    if (!grid) return;
    const $wrapper = $(grid.wrapper);
    $wrapper.find('.grid-download, .grid-upload').hide();
    $wrapper.find('[data-label="Download"], [data-label="Upload"]')
        .closest('li').hide();
}

function setup_sub_items_grid_template_buttons(frm) {
    const grid = frm.fields_dict?.custom_sub_items?.grid;
    if (!grid) return;

    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('si-sub-items-grid-custom')) {
        $wrapper.addClass('si-sub-items-grid-custom');
        if (!$('#si-sub-items-grid-custom-style').length) {
            $('<style id="si-sub-items-grid-custom-style">' +
              '.si-sub-items-grid-custom .grid-download,' +
              '.si-sub-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    _hide_standard_sub_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_sub_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-si-sub-items-template-btns').length) return;

        const $custom = $('<div class="custom-si-sub-items-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Sub Items Template'))
                .on('click', () => {
                    const si = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.si_sub_items_template.get_si_sub_items_template'
                        + (si ? `?sales_invoice=${si}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Sub Items Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Sales Invoice before uploading.'));
                        return;
                    }
                    show_sub_items_upload_dialog(frm);
                })
        );

        const $downloadBtn = $wrapper.find('.grid-download');
        if ($downloadBtn.length && !$downloadBtn.parent().is($footer)) {
            // download button is inside a right-side wrapper div — inject alongside it
            $downloadBtn.parent().append($custom);
        } else {
            // no download button, or it is a direct child of the footer flex container —
            // use margin-left:auto to pin our buttons to the right edge
            $custom.css('margin-left', 'auto');
            ($footer.length ? $footer : $wrapper).append($custom);
        }
    }, 400);
}

function show_sub_items_upload_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __('Upload Sub Items Template'),
        fields: [
            {
                label: __('File (.xlsx or .csv)'),
                fieldname: 'template_file',
                fieldtype: 'Attach',
                reqd: 1,
                description: __(
                    'Upload the filled sub items template. ' +
                    'Row 1 = labels, Row 2 = fieldnames, Row 3+ = data. ' +
                    'Each row needs parent_item and sub_item_code.'
                )
            }
        ],
        primary_action_label: __('Import'),
        primary_action(values) {
            if (!values.template_file) {
                frappe.msgprint(__('Please attach a file first.'));
                return;
            }
            const ext = values.template_file.split('.').pop().toLowerCase();
            if (!['xlsx', 'csv'].includes(ext)) {
                frappe.msgprint(__('Only .xlsx and .csv files are supported.'));
                return;
            }

            d.set_df_property('template_file', 'read_only', 1);
            d.get_primary_btn().prop('disabled', true).text(__('Importing…'));

            frappe.call({
                method: 'export.api.si_sub_items_template.import_si_sub_items',
                args: {
                    sales_invoice: frm.doc.name,
                    file_url: values.template_file
                },
                callback(r) {
                    d.hide();
                    if (r.message) {
                        frappe.show_alert({
                            message: __(r.message.message),
                            indicator: 'green'
                        }, 6);
                        frm.reload_doc();
                    }
                },
                error() {
                    d.set_df_property('template_file', 'read_only', 0);
                    d.get_primary_btn().prop('disabled', false).text(__('Import'));
                }
            });
        }
    });
    d.show();
}


function hide_items_rows(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    const hide = () => {
        const rows = grid.grid_rows || [];
        if (!rows.length) return;

        // Example 1: hide by item_code
        rows.forEach((row) => {
            if (row?.doc?.item_code === "Bank Charges") {
                row.wrapper.hide();
            }
        });

        // Example 2: hide last row (uncomment if needed)
        // rows[rows.length - 1].wrapper.hide();
    };

    // Grid can re-render after refresh/reset, so defer once
    setTimeout(hide, 0);
}

function carry_forward_sub_items(frm) {
    // Only run for genuinely new (unsaved) documents — prevents dirty state on open
    if (!frm.is_new()) return;
    // Never mutate a submitted or cancelled document
    if (frm.doc.docstatus !== 0) return;

    // If custom_sub_items already populated, skip
    if (frm.doc.custom_sub_items && frm.doc.custom_sub_items.length > 0) return;

    // Get reference from items child table - try Sales Order first, then Delivery Note
    let ref_doctype = null;
    let ref_name = null;
    if (frm.doc.items && frm.doc.items.length > 0) {
         if (frm.doc.items[0].delivery_note) {
            ref_doctype = 'Delivery Note';
            ref_name = frm.doc.items[0].delivery_note;
        } else if (frm.doc.items[0].sales_order) {
            ref_doctype = 'Sales Order';
            ref_name = frm.doc.items[0].sales_order;
        }
    }

    if (ref_doctype && ref_name) {
        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: ref_doctype,
                name: ref_name
            },
            callback: function(r) {
                if (r.message && r.message.custom_sub_items && r.message.custom_sub_items.length > 0) {
                    frm.doc.custom_sub_items = [];
                    r.message.custom_sub_items.forEach(function(sub_item) {
                        let new_sub = frm.add_child('custom_sub_items');
                        new_sub.parent_row_uid = sub_item.parent_row_uid;
                        new_sub.parent_item = sub_item.parent_item;
                        new_sub.parent_item_name = sub_item.parent_item_name;
                        new_sub.sub_item_code = sub_item.sub_item_code;
                        new_sub.sub_item_name = sub_item.sub_item_name;
                        new_sub.customer_item_code = sub_item.customer_item_code;
                        new_sub.custom_customer_po_no = sub_item.custom_customer_po_no;
                        new_sub.sub_description = sub_item.sub_description;
                        new_sub.qty = sub_item.qty;
                        new_sub.custom_net_weight = sub_item.custom_net_weight;
                        new_sub.base_rate = sub_item.base_rate;
                        new_sub.rate = sub_item.rate;
                        new_sub.amount = sub_item.amount;
                        new_sub.custom_freight__insurance_ = sub_item.custom_freight__insurance_;
                        new_sub.custom_cif_unit_price = sub_item.custom_cif_unit_price;
                        new_sub.custom__cif_total_amount = sub_item.custom__cif_total_amount;
                        new_sub.custom_cif_unit_price_ = sub_item.custom_cif_unit_price_;
                        new_sub.custom___cif_total_amount = sub_item.custom___cif_total_amount;
                        new_sub.duty_drawback = sub_item.duty_drawback;
                        if (sub_item.sub_item_code) {
                            frappe.call({
                                method: 'frappe.client.get',
                                args: {
                                    doctype: 'Item',
                                    name: sub_item.sub_item_code
                                },
                                callback: function(res) {
                                    if (res.message) {
                                        let weight = res.message.weight_per_unit || 0;
                                        // Calculate net weight
                                        new_sub.custom_net_weight = flt(weight) * flt(sub_item.qty);
                                    }
                                }
                            });
                        }
                    });
                    frm.refresh_field('custom_sub_items');
                }
            }
        });
    }
}




function apply_parent_values_from_sub_items(frm) {
    if (!frm.doc.items || !frm.doc.custom_sub_items) return;

    let sub_items = frm.doc.custom_sub_items || [];
    if (!sub_items.length) return;

    // =========================
    // STEP 1: GROUP SUB ITEMS
    // =========================
    let grouped = {};

    sub_items.forEach(sub => {

        // ✅ NEW KEY: parent item_code + qty
        let key = `${sub.parent_item}__${flt(sub.qty)}`;
        if (!sub.parent_item) return;

        if (!grouped[key]) {
            grouped[key] = {
                rate_sum: 0,
                qty: flt(sub.qty),
                has_qty: true,
                freight_pct: null,
                has_freight: false
            };
        }

        grouped[key].rate_sum += flt(sub.rate);

        // take first freight value
        if (
            !grouped[key].has_freight &&
            (sub.custom_freight__insurance_ || sub.custom_freight__insurance_ === 0)
        ) {
            grouped[key].freight_pct = flt(sub.custom_freight__insurance_);
            grouped[key].has_freight = true;
        }
    });

    let conversion_rate = flt(frm.doc.conversion_rate) || 1;

    // =========================
    // STEP 2: APPLY TO PARENT
    // =========================
    (frm.doc.items || []).forEach(row => {

        // ✅ MATCH USING item_code + qty
        let key = `${row.item_code}__${flt(row.qty)}`;
        let group = grouped[key];

        if (!group) return;

        let next_rate = group.rate_sum;
        let next_qty = flt(row.qty);
        let next_freight = group.has_freight
            ? group.freight_pct
            : flt(row.custom_freight__insurance_);

        // Set rate
        frappe.model.set_value(row.doctype, row.name, "rate", next_rate);

        // Set qty (always safe here since matching is qty-based)
        frappe.model.set_value(row.doctype, row.name, "qty", next_qty);

        // Set freight if available
        if (group.has_freight) {
            frappe.model.set_value(
                row.doctype,
                row.name,
                "custom_freight__insurance_",
                next_freight
            );
        }

        // Calculations
        let base_rate = next_rate * conversion_rate;
        let amount = next_rate * next_qty;

        frappe.model.set_value(row.doctype, row.name, "base_rate", base_rate);
        frappe.model.set_value(row.doctype, row.name, "amount", amount);

        calculate_cif_values(frm, row.doctype, row.name);
    });
}


function toggle_cif_total_by_currency(frm) {
    const show = frm.doc.currency !== "INR";
    frm.toggle_display("custom_cif_total_amount_", show);
}


function toggle_sub_items_columns(frm) {
    if (!frm.fields_dict.custom_sub_items) return;

    const is_export = frm.doc.custom_order_type === "Export";

    let grid = frm.fields_dict.custom_sub_items.grid;
    let columns_to_show = [];

    if (is_export) {
        // Display columns for Export order type
        columns_to_show = [
            { fieldname: 'duty_drawback', columns: 1 },
            { fieldname: 'parent_item', columns: 1 },
            { fieldname: 'sub_item_code', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'rate', columns: 1 },
            { fieldname: 'amount', columns: 1 },
            { fieldname: 'custom_net_weight', columns: 1 },
            { fieldname: 'custom_freight__insurance_', columns: 1 },
            { fieldname: 'custom_cif_unit_price_', columns: 1 },
            { fieldname: 'custom___cif_total_amount', columns: 1 }
        ];
    } else {
        // Reset to default columns for non-Export order types
        columns_to_show = [];
    }


        let value = {};
        value[grid.doctype] = columns_to_show;

        frappe.model.user_settings.save(frm.doctype, 'GridView', value).then((r) => {
            frappe.model.user_settings[frm.doctype] = r.message || r;
            grid.reset_grid();
            grid.update_docfield_property('duty_drawback', 'hidden', 0);
            grid.update_docfield_property('duty_drawback', 'in_list_view', 1);
            frm.refresh_field("custom_sub_items");
        });

}


/************************************
 * SHOW / HIDE EXPORT FIELDS (ITEMS)
 ************************************/
function toggle_export_fields(frm) {
    if (!frm.fields_dict.items) return;

    const is_export = frm.doc.custom_order_type === "Export";

    let grid = frm.fields_dict.items.grid;
    let columns_to_show = [];

    if (is_export) {
        // Display columns for Export order type
        columns_to_show = [
            { fieldname: 'custom_duty_drawback', columns: 1 },
            { fieldname: 'item_code', columns: 1 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'rate', columns: 1 },
            { fieldname: 'amount', columns: 1 },
            { fieldname: 'total_weight', columns: 1 },
            { fieldname: 'custom_freight__insurance_', columns: 1 },
            { fieldname: 'custom_cif_unit_price_', columns: 1 },
            { fieldname: 'custom___cif_total_amount', columns: 1 }
        ];
    } else {
        // Reset to default columns for non-Export order types
        columns_to_show = [
            { fieldname: 'item_code', columns: 2 },
            { fieldname: 'qty', columns: 2 },
            { fieldname: 'rate', columns: 2 },
            { fieldname: 'amount', columns: 2 },];
    }

    try {
        let value = {};
        value[grid.doctype] = columns_to_show;

        frappe.model.user_settings.save(frm.doctype, 'GridView', value).then((r) => {
            frappe.model.user_settings[frm.doctype] = r.message || r;
            grid.reset_grid();
            frm.refresh_field("items");
            hide_items_rows(frm);
        });

    } catch (e) {
        console.log("Error toggling export fields:", e);
    }
}

function update_sub_items_qty(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row.item_code || !row.custom_row_uid) return;

    const parent_qty = flt(row.qty) || 0;
    const uid = row.custom_row_uid;

    frappe.call({
        method: 'frappe.client.get',
        args: { doctype: 'Item', name: row.item_code },
        callback: function(r) {
            if (!r.message || !r.message.custom_sub_items || !r.message.custom_sub_items.length) return;

            // Build a base-qty map: sub_item_code → configured qty from Item master
            let base_qty_map = {};
            r.message.custom_sub_items.forEach(function(si) {
                base_qty_map[si.sub_item_code] = flt(si.qty) || 1;
            });

            // Update matching sub-items in the SO
            let updated = false;
            (frm.doc.custom_sub_items || []).forEach(function(sub) {
                if (sub.parent_row_uid !== uid) return;
                let base = base_qty_map[sub.sub_item_code] || flt(sub.qty) || 1;
                frappe.model.set_value('Sales Invoice Sub Items', sub.name, 'qty', parent_qty * base);
                updated = true;
            });

            if (updated) frm.refresh_field('custom_sub_items');
        }
    });
}

frappe.ui.form.on("Sales Invoice Item", {
    items_add(frm, cdt, cdn) {
        // Ensure visibility is set when new row is added
        setTimeout(() => {
            toggle_export_fields(frm);
        }, 100);
    },

    rate(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        calculate_net_weight(frm, cdt, cdn);
        calculate_cif_values(frm, cdt, cdn);
        update_sub_items_qty(frm, cdt, cdn);
        // setTimeout(() => recalculate_si_totals(frm), 150);
    },

    weight_per_unit(frm, cdt, cdn) {
        calculate_net_weight(frm, cdt, cdn);
        // setTimeout(() => recalculate_si_totals(frm), 150);
    },

    custom_freight__insurance_(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },
    

    item_code(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

        if (row.item_code) {
            let old_uid = row.custom_row_uid;
            let new_uid = frappe.utils.get_random(8) + '_' + Date.now();
            frappe.model.set_value(cdt, cdn, 'custom_row_uid', new_uid);

            if (old_uid) {
                let existing_sub_items = frm.doc.custom_sub_items || [];
                frm.doc.custom_sub_items = existing_sub_items.filter(function(sub) {
                    return sub.parent_row_uid !== old_uid;
                });
            }

            frappe.call({
                method: 'frappe.client.get',
                args: {
                    doctype: 'Item',
                    name: row.item_code
                },
                callback: function(r) {
                    if (r.message && r.message.custom_sub_items && r.message.custom_sub_items.length > 0) {
                        r.message.custom_sub_items.forEach(function(sub_item) {
                            let sub_row = frm.add_child('custom_sub_items');
                            sub_row.parent_row_uid = new_uid;
                            sub_row.parent_item = row.item_code;
                            if (frm.fields_dict.custom_sub_items.grid.docfields.find(f => f.fieldname === 'parent_item_name')) {
                                sub_row.parent_item_name = row.item_name;
                            }
                            sub_row.sub_item_code = sub_item.sub_item_code;
                            sub_row.sub_item_name = sub_item.sub_item_name;
                            sub_row.sub_description = sub_item.sub_description;
                            sub_row.qty = sub_item.qty;
                        });

                        frm.refresh_field('custom_sub_items');
                        frappe.show_alert({
                            message: __('Sub-items populated for {0}', [row.item_code]),
                            indicator: 'green'
                        }, 3);
                    }

                    // Fetch Customer Part No from Item's customer_items table
                    if (frm.doc.customer && r.message.customer_items && r.message.customer_items.length > 0) {
                        let customer_item = r.message.customer_items.find(
                            ci => ci.customer_name === frm.doc.customer
                        );
                        if (customer_item && customer_item.ref_code) {
                            frappe.model.set_value(cdt, cdn, "custom_customer_part_no", customer_item.ref_code);
                        }
                    }

                    setTimeout(() => {
                        calculate_net_weight(frm, cdt, cdn);
                    }, 300);
                }
            });
        } else {
            setTimeout(() => {
                calculate_cif_values(frm, cdt, cdn);
            }, 300);
        }
    },

    before_items_remove(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.custom_row_uid && frm.doc.custom_sub_items) {
            frm.doc.custom_sub_items = frm.doc.custom_sub_items.filter(function(sub) {
                return sub.parent_row_uid !== row.custom_row_uid;
            });
            frm.refresh_field('custom_sub_items');
        }
    }
});



frappe.ui.form.on("Sales Invoice Sub Items", {
    rate(frm, cdt, cdn) {
        calculate_sub_item_base_rate(frm, cdt, cdn);
        calculate_sub_item_cif_values(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        calculate_sub_item_cif_values(frm, cdt, cdn);
    },

    custom_freight__insurance_(frm, cdt, cdn) {
        calculate_sub_item_cif_values(frm, cdt, cdn);
    }
});


/************************************
 * NET WEIGHT CALCULATION
 ************************************/
function calculate_net_weight(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let qty = flt(row.qty);
    let weight_per_unit = flt(row.weight_per_unit);
    frappe.model.set_value(cdt, cdn, "custom_net_weight", qty * weight_per_unit);
}


/************************************
 * ROW-LEVEL CIF CALCULATION
 ************************************/
function calculate_cif_values(frm, cdt, cdn) {
    if (frm.doc.custom_order_type !== "Export") return;

    let row = locals[cdt][cdn];

    // Skip CIF calculation for service items
    if (row.item_group === "Services") {
        frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", 0);
        frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", 0);
        frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", 0);
        frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", 0);
        setTimeout(() => {
            calculate_si_cif_totals(frm);
        }, 100);
        return;
    }

    let base_rate = flt(row.base_rate); // company currency (INR)
    let rate = flt(row.rate);           // order currency
    let qty = flt(row.qty);
    let freight_pct = flt(row.custom_freight__insurance_);

    // Order currency CIF
    let cif_unit_currency = flt(rate + (rate * freight_pct / 100), 2);
    let cif_total_currency = cif_unit_currency * qty;
    
    let conversion_rate = flt(frm.doc.conversion_rate);
    if (!conversion_rate) {
        conversion_rate = 1;
    }
    // Company currency CIF
    let cif_unit_company = flt(cif_unit_currency * conversion_rate, 2);
    let cif_total_company = cif_unit_company * qty;

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", (freight_pct && freight_pct > 0) ?  cif_unit_company : 0);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", (freight_pct && freight_pct > 0) ?  cif_total_company : 0);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", (freight_pct && freight_pct > 0) ?  cif_unit_currency : 0);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", (freight_pct && freight_pct > 0) ?  cif_total_currency : 0);

    // Recalculate totals after updating row values
    setTimeout(() => {
        calculate_si_cif_totals(frm);
    }, 100);
}


/************************************
 * SUB-ITEM BASE RATE CALCULATION
 ************************************/
function calculate_sub_item_base_rate(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    let rate = flt(row.rate);
    let conversion_rate = flt(frm.doc.conversion_rate);
    if (!conversion_rate) {
        conversion_rate = 1;
    }

    let base_rate = rate * conversion_rate;
    frappe.model.set_value(cdt, cdn, "base_rate", base_rate);
}


/************************************
 * SUB-ITEM ROW-LEVEL CIF CALCULATION
 ************************************/
function calculate_sub_item_cif_values(frm, cdt, cdn) {
    let row = locals[cdt] && locals[cdt][cdn];

    // Fallback: if row not in locals, find it in frm.doc
    if (!row) {
        row = frm.doc.custom_sub_items.find(r => r.name === cdn);
    }

    if (!row) return; // Exit if row still not found

    let base_rate = flt(row.base_rate);
    let rate = flt(row.rate);
    let qty = flt(row.qty);
    let freight_pct = flt(row.custom_freight__insurance_);

    // Calculate Amount (always)
    let amount = rate * qty;
    frappe.model.set_value(cdt, cdn, "amount", amount);
    frappe.model.set_value(cdt, cdn, "amount_in_inr", flt(base_rate * qty, 2));

    // CIF calculations only for Export orders
    if (frm.doc.custom_order_type !== "Export") return;

    // Order currency CIF
    let cif_unit_currency = flt(rate + (rate * freight_pct / 100), 2);
    let cif_total_currency = cif_unit_currency * qty;
    
    let conversion_rate = flt(frm.doc.conversion_rate);
    if (!conversion_rate) {
        conversion_rate = 1;
    }
    // Company currency CIF
    let cif_unit_company = flt(cif_unit_currency * conversion_rate, 2);
    let cif_total_company = cif_unit_company * qty;
    if (row.sub_item_code) {
        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Item',
                name: row.sub_item_code
            },
            callback: function(res) {
                if (res.message) {
                    let weight = res.message.weight_per_unit || 0;
                    frappe.model.set_value(cdt, cdn, "custom_net_weight", flt(weight) * flt(row.qty));
                }
            }
        });
    }

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", (freight_pct && freight_pct > 0) ?  cif_unit_company : 0);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount",(freight_pct && freight_pct > 0) ?  cif_total_company : 0);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", (freight_pct && freight_pct > 0) ? cif_unit_currency : 0);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", (freight_pct && freight_pct > 0) ? cif_total_currency : 0);
}


/************************************
 * SALES INVOICE TOTAL QTY & NET WEIGHT
 ************************************/
// function recalculate_si_totals(frm) {
//     if (frm.doc.docstatus !== 0) return;
//     let total_qty = 0;
//     let total_net_weight = 0;
//     (frm.doc.items || []).forEach(row => {
//         if (row.item_code === "Bank Charges") return;
//         total_qty += flt(row.qty);
//         total_net_weight += flt(row.total_weight);
//     });
//     frm.set_value("total_qty", total_qty);
//     frm.set_value("total_net_weight", flt(total_net_weight, 2));
// }


/************************************
 * SALES INVOICE TOTAL CIF
 ************************************/
function calculate_si_cif_totals(frm) {
    if (frm.doc.custom_order_type !== "Export") {
        // Clear totals if not export
        frm.set_value("custom_cif_total_amount_company_currency", 0);
        frm.set_value("custom_cif_total_amount_", 0);
        return;
    }

    let total_company = 0;
    let total_currency = 0;
    let total_item_amount = 0;

    (frm.doc.items || []).forEach(row => {
        // Skip Bank Charges item when calculating totals
        if (row.item_code === "Bank Charges") return;

        total_company += flt(row.custom__cif_total_amount);
        total_currency += flt(row.custom___cif_total_amount);
        total_item_amount += flt(row.amount);
    });

    frm.set_value(
        "custom_cif_total_amount_company_currency",
        total_company
    );
    frm.set_value(
        "custom_cif_total_amount_",
        total_currency
    );
    let conversion_rate = flt(frm.doc.conversion_rate) || 1;
    frm.set_value("custom_total_amount", total_item_amount);
    frm.set_value("custom_total_company_currency", total_item_amount * conversion_rate);

    // Compute rounding error using 2-decimal rounded values to match visible UI totals
    if (frm.doc.docstatus === 0) {
        let cif_total        = flt(total_currency, 2);
        let company_total    = flt(total_company, 2);
        let rate             = flt(conversion_rate, 2);
        let conversion_value = flt(cif_total * rate, 2);
        let rounding_error   = flt(Math.abs(conversion_value - company_total), 2);
        // let round_off_inr = frm.doc.custom_cif_total_amount_company_currency - frm.doc.base_grand_total
        let updated_total_inr = 0;
        let total_amount_to_be_used_inr = 0;
        if (frm.doc.custom_cif_total_amount_company_currency==0){
            total_amount_to_be_used_inr = frm.doc.base_total
        }else{
            total_amount_to_be_used_inr=frm.doc.custom_cif_total_amount_company_currency
        }
        let round_off_inr =
            (total_amount_to_be_used_inr || 0) -
            (frm.doc.base_grand_total || 0);
        // INR LOGIC
        let selected_rows_inr = (frm.doc.taxes || []).filter(
            d => d.custom_reduce_round_off === 1
        );

        updated_total_inr = selected_rows_inr.reduce((sum, row) => {
            return sum + (row.base_tax_amount || 0);
        }, 0);

        if (updated_total_inr > 0) {
            if (round_off_inr < 0) {
                round_off_inr += updated_total_inr;
            } else {
                round_off_inr -= updated_total_inr;
            }
        }

        frm.set_value("custom_rounding_error_currency_conversion",Math.abs(round_off_inr));


        // USD LOGIC
        let updated_total_usd = 0;
        let total_amount_to_be_used = 0;
        if (frm.doc.custom_cif_total_amount_==0){
            total_amount_to_be_used = frm.doc.total
        }else{
            total_amount_to_be_used=frm.doc.custom_cif_total_amount_
        }
        let round_off_usd =
            (total_amount_to_be_used || 0) -
            (frm.doc.grand_total || 0);

            let selected_rows_usd = (frm.doc.taxes || []).filter(
            d => d.custom_reduce_round_off === 1
        );

        updated_total_usd = selected_rows_usd.reduce((sum, row) => {
            return sum + (row.tax_amount || 0);
        }, 0);

        if (updated_total_usd > 0) {
            if (round_off_usd < 0) {
                round_off_usd += updated_total_usd;
            } else {
                round_off_usd -= updated_total_usd;
            }
        }

        frm.set_value("custom_rounding_error_usd",Math.abs(round_off_usd));
        // if (flt(frm.doc.custom_rounding_error_currency_conversion) !== rounding_error) {
        //     frm.set_value("custom_rounding_error_currency_conversion", rounding_error);
        // }
    }
}


// calculate_rounding_error() removed — rounding error is now computed
// exclusively inside calculate_si_cif_totals(), after totals are final.


/************************************
 * ADD BANK CHARGES ITEM
 ************************************/
function add_bank_charges_item(frm) {
    if (frm.doc.custom_order_type !== "Export") return;
    
    // Calculate CIF total and actual total (excluding Bank Charges)
    let cif_total_currency = 0;
    let actual_total_currency = 0;
    let existing_bank_charges_row = null;
    
    (frm.doc.items || []).forEach(row => {
        if (row.item_code === "Bank Charges") {
            existing_bank_charges_row = row;
            return;
        }
        cif_total_currency += flt(row.custom___cif_total_amount);
        actual_total_currency += flt(row.amount);
    });
    
    // Calculate the difference between CIF total and actual total
    let cif_difference = cif_total_currency - actual_total_currency;
    
    // Only proceed if there's a positive difference
    if (cif_difference <= 0) {
        // Remove Bank Charges if exists and no difference needed
        if (existing_bank_charges_row) {
            frm.doc.items = frm.doc.items.filter(row => row.item_code !== "Bank Charges");
        }
        return;
    }

    // If Bank Charges exists, update its rate
    if (existing_bank_charges_row) {
        existing_bank_charges_row.rate = cif_difference;
        existing_bank_charges_row.amount = cif_difference;
    } else {
        // Add new Bank Charges item at the end
        console.log("Adding Bank Charges item with amount:", cif_difference);
        let new_row = frm.add_child("items");
        new_row.item_code = "Bank Charges";
        new_row.item_name = "Bank Charges";
        new_row.description = "Bank Charges";
        new_row.item_group = "Services";
        new_row.uom = "Nos";
        new_row.stock_uom = "Nos";
        new_row.conversion_factor = 1;
        new_row.qty = 1;
        new_row.rate = cif_difference;
        new_row.amount = cif_difference;
        new_row.income_account = "Sales - GME";
        // Set CIF values to 0 for service item
        new_row.custom_cif_unit_price = 0;
        new_row.custom__cif_total_amount = 0;
        new_row.custom_cif_unit_price_ = 0;
        new_row.custom___cif_total_amount = 0;
    }
}

/**********************************************************
 * Update base rate in child table based on conversion rate
 **********************************************************/
function update_base_rate_for_all_items(frm) {
    let conversion_rate = flt(frm.doc.conversion_rate) || 1;

    (frm.doc.custom_sub_items || []).forEach(row => {
        let new_base_rate = flt(row.rate) * conversion_rate;

        frappe.model.set_value(
            row.doctype,
            row.name,
            "base_rate",
            new_base_rate
        );
    });
}

/* ===== OLD CODE (COMMENTED) =====

frappe.ui.form.on("Sales Invoice", {
    refresh(frm) {
        toggle_export_fields_si(frm);
        toggle_cif_total_by_currency(frm);
    },

    custom_order_type(frm) {
        toggle_export_fields_si(frm);
        calculate_si_cif_totals(frm);
    },

    currency(frm) {
        toggle_cif_total_by_currency(frm);
        calculate_si_cif_totals(frm);
    },

    validate(frm) {
        calculate_si_cif_totals(frm);
    },

    onload(frm) {
        toggle_export_fields_si(frm);
    }
});


function toggle_export_fields_si(frm) {
    if (!frm.fields_dict.items) return;

    const is_export = frm.doc.custom_order_type === "Export";
    const grid = frm.fields_dict.items.grid;

    const export_fields = [
        "custom_net_weight",
        "custom_cif_unit_price",
        "custom_cif_unit_price_",
        "custom_freight__insurance_",
        "custom__cif_total_amount",
        "custom___cif_total_amount"
    ];

    export_fields.forEach(fieldname => {
        grid.update_docfield_property(
            fieldname,
            "hidden",
            is_export ? 0 : 1
        );

        grid.update_docfield_property(
            fieldname,
            "in_list_view",
            is_export ? 1 : 0
        );
    });

    frm.refresh_field("items");
}

//override sales invoice item table 

frappe.ui.form.on("Sales Invoice Item", {
    items_add(frm) {
        setTimeout(() => {
            toggle_export_fields_si(frm);
        }, 100);
    },

    rate(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },

    qty(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },

    custom_freight__insurance_(frm, cdt, cdn) {
        calculate_cif_values(frm, cdt, cdn);
    },

    item_code(frm, cdt, cdn) {
        setTimeout(() => {
            calculate_cif_values(frm, cdt, cdn);
        }, 300);
    }
});


function toggle_cif_total_by_currency(frm) {
    const show = frm.doc.currency !== "INR";
    frm.toggle_display("custom_cif_total_amount_", show);
}


function calculate_cif_values(frm, cdt, cdn) {
    if (frm.doc.custom_order_type !== "Export") return;

    const row = locals[cdt][cdn];

    const base_rate = flt(row.base_rate);
    const rate = flt(row.rate);
    const qty = flt(row.qty);
    const freight_pct = flt(row.custom_freight__insurance_);

    const cif_unit_company =
        base_rate + (base_rate * freight_pct / 100);
    const cif_total_company = cif_unit_company * qty;

    const cif_unit_currency =
        rate + (rate * freight_pct / 100);
    const cif_total_currency = cif_unit_currency * qty;

    frappe.model.set_value(
        cdt,
        cdn,
        "custom_cif_unit_price",
        cif_unit_company
    );

    frappe.model.set_value(
        cdt,
        cdn,
        "custom__cif_total_amount",
        cif_total_company
    );

    frappe.model.set_value(
        cdt,
        cdn,
        "custom_cif_unit_price_",
        cif_unit_currency
    );

    frappe.model.set_value(
        cdt,
        cdn,
        "custom___cif_total_amount",
        cif_total_currency
    );

    setTimeout(() => {
        calculate_si_cif_totals(frm);
    }, 100);
}


function calculate_si_cif_totals(frm) {
    if (frm.doc.custom_order_type !== "Export") {
        frm.set_value("custom_cif_total_amount_company_currency", 0);
        frm.set_value("custom_cif_total_amount_", 0);
        return;
    }

    let total_company = 0;
    let total_currency = 0;

    (frm.doc.items || []).forEach(row => {
        total_company += flt(row.custom__cif_total_amount);
        total_currency += flt(row.custom___cif_total_amount);
    });

    frm.set_value(
        "custom_cif_total_amount_company_currency",
        total_company
    );

    frm.set_value(
        "custom_cif_total_amount_",
        total_currency
    );
}

===== END OLD CODE ===== */
