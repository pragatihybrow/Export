/************************************
 * DELIVERY NOTE (PARENT)
 ************************************/
frappe.ui.form.on("Delivery Note", {
    refresh(frm) {
        toggle_export_fields(frm);
        toggle_cif_total_by_currency(frm);
        toggle_sub_items_columns(frm);
        hide_items_rows(frm);
        // recalculate_dn_totals(frm);

        setup_items_grid_template_buttons(frm);
        setup_sub_items_grid_template_buttons(frm);

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
        calculate_dn_cif_totals(frm);
    },

    currency(frm) {
        toggle_cif_total_by_currency(frm);
        calculate_dn_cif_totals(frm);
    },

    validate(frm) {
        // Recalculate all sub-item values first
        if (frm.doc.custom_sub_items) {
            frm.doc.custom_sub_items.forEach(row => {
                calculate_sub_item_cif_values(frm, 'Delivery Note Sub Items', row.name);
            });
        }

        apply_parent_values_from_sub_items(frm);
        calculate_dn_cif_totals(frm);
        // recalculate_dn_totals(frm);

        // Add Bank Charges item at the end when order type is Export
        // Commented out: reverting CIF difference adjustment via Bank Charges
        // if (frm.doc.custom_order_type === "Export") {
        //     add_bank_charges_item(frm);
        //     hide_items_rows(frm);
        // }
    },

    onload_post_render(frm) {
        toggle_export_fields(frm);
        toggle_sub_items_columns(frm);
        carry_forward_sub_items(frm);
        hide_items_rows(frm);
        setup_items_grid_template_buttons(frm);
    }
});

function hide_items_rows(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    const hide = () => {
        const rows = grid.grid_rows || [];
        if (!rows.length) return;

        // Hide Bank Charges rows
        rows.forEach((row) => {
            if (row?.doc?.item_code === "Bank Charges") {
                row.wrapper.hide();
            }
        });
    };

    // Grid can re-render after refresh/reset, so defer once
    setTimeout(hide, 0);
}


/************************************
 * ITEMS GRID – CUSTOM TEMPLATE BUTTONS
 * Replaces the standard Download/Upload template actions
 * with custom ones injected into the child-table footer.
 ************************************/
function _hide_standard_items_template_buttons(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;
    const $wrapper = $(grid.wrapper);
    $wrapper.find('.grid-download, .grid-upload').hide();
    $wrapper.find('[data-label="Download"], [data-label="Upload"]')
        .closest('li').hide();
    frm.page.wrapper
        .find('.dropdown-menu [data-label="Download"], .dropdown-menu [data-label="Upload"]')
        .closest('li').hide();
}

function setup_items_grid_template_buttons(frm) {
    const grid = frm.fields_dict?.items?.grid;
    if (!grid) return;

    // --- Prevent flash of standard buttons on initial render ---
    // A CSS rule inserted into <head> immediately hides .grid-download/.grid-upload
    // inside this specific wrapper the moment Frappe renders them — no setTimeout needed.
    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('dn-items-grid-custom')) {
        $wrapper.addClass('dn-items-grid-custom');
        if (!$('#dn-items-grid-custom-style').length) {
            $('<style id="dn-items-grid-custom-style">' +
              '.dn-items-grid-custom .grid-download,' +
              '.dn-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    // Also call the explicit hide for any already-rendered buttons.
    _hide_standard_items_template_buttons(frm);

    setTimeout(() => {
        // --- Hide standard template buttons again after grid fully renders ---
        _hide_standard_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');

        // On submitted/To Bill docs Frappe hides .grid-footer (display:none).
        // Restore it with display:flex so our buttons appear in the same right-aligned
        // position as the standard buttons. Keep .grid-buttons (Add Row etc.) hidden
        // since the doc is not editable.
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        // --- Inject custom buttons once (guard against re-render duplicates) ---
        if ($wrapper.find('.custom-dn-template-btns').length) return;

        const $custom = $('<div class="custom-dn-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Template'))
                .on('click', () => {
                    // Do not pass delivery_note for new/unsaved docs – the record
                    // does not exist in DB yet, so the backend would 404.
                    const dn = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.delivery_note_template.get_delivery_note_custom_template'
                        + (dn ? `?delivery_note=${dn}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Delivery Note before uploading the template.'));
                        return;
                    }
                    show_upload_dialog(frm);
                })
        );

        // Inject into the same right-side container as the standard buttons.
        // .grid-footer is now guaranteed visible (restored above if it was hidden).
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


/************************************
 * UPLOAD TEMPLATE DIALOG
 ************************************/
function show_upload_dialog(frm) {
    const d = new frappe.ui.Dialog({
        title: __('Upload Custom Template'),
        fields: [
            {
                label: __('File (.xlsx or .csv)'),
                fieldname: 'template_file',
                fieldtype: 'Attach',
                reqd: 1,
                description: __(
                    'Upload the filled custom template. ' +
                    'Row 1 = labels, Row 2 = fieldnames, Row 3+ = data. ' +
                    'Each data row updates the matching Delivery Note Item by item_code.'
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
                method: 'export.api.delivery_note_template.import_delivery_note_items',
                args: {
                    delivery_note: frm.doc.name,
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

    // Same CSS-first approach as the items grid — hides standard buttons before they render.
    const $wrapper = $(grid.wrapper);
    if (!$wrapper.hasClass('dn-sub-items-grid-custom')) {
        $wrapper.addClass('dn-sub-items-grid-custom');
        if (!$('#dn-sub-items-grid-custom-style').length) {
            $('<style id="dn-sub-items-grid-custom-style">' +
              '.dn-sub-items-grid-custom .grid-download,' +
              '.dn-sub-items-grid-custom .grid-upload { display:none !important; }' +
              '</style>').appendTo('head');
        }
    }
    _hide_standard_sub_items_template_buttons(frm);

    setTimeout(() => {
        _hide_standard_sub_items_template_buttons(frm);

        const $footer = $wrapper.find('.grid-footer');

        // Same footer-restore logic as the items grid:
        // show .grid-footer with flex if hidden, keep .grid-buttons hidden on submitted docs.
        if ($footer.length && !$footer.is(':visible')) {
            $footer.css('display', 'flex');
            $footer.find('.grid-buttons').hide();
        }

        if ($wrapper.find('.custom-dn-sub-items-template-btns').length) return;

        const $custom = $('<div class="custom-dn-sub-items-template-btns flex gap-2"></div>');

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Download Sub Items Template'))
                .on('click', () => {
                    const dn = (!frm.is_new() && frm.doc.name)
                        ? encodeURIComponent(frm.doc.name)
                        : '';
                    const url = frappe.urllib.get_full_url(
                        '/api/method/export.api.dn_sub_items_template.get_dn_sub_items_template'
                        + (dn ? `?delivery_note=${dn}` : '')
                    );
                    window.open(url, '_blank');
                })
        );

        $custom.append(
            $('<button class="btn btn-xs btn-secondary">')
                .text(__('Upload Sub Items Template'))
                .on('click', () => {
                    if (frm.is_new()) {
                        frappe.msgprint(__('Please save the Delivery Note before uploading.'));
                        return;
                    }
                    show_sub_items_upload_dialog(frm);
                })
        );

        // Inject into the right-side container (same position as standard buttons).
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
                method: 'export.api.dn_sub_items_template.import_dn_sub_items',
                args: {
                    delivery_note: frm.doc.name,
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


function carry_forward_sub_items(frm) {
    // Never mutate a submitted or cancelled document
    if (frm.doc.docstatus !== 0 || !frm.is_new()) return;
    frm.clear_table("custom_sub_items");

    // If custom_sub_items already populated, skip
    if (frm.doc.custom_sub_items && frm.doc.custom_sub_items.length > 0) return;

    // Get Sales Order reference from first item's sales_order_no field
    let sales_order_ref = null;
    if (frm.doc.items && frm.doc.items.length > 0) {
        sales_order_ref = frm.doc.items[0].against_sales_order;
    }

    if (sales_order_ref) {
        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Sales Order',
                name: sales_order_ref
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
                        new_sub.sub_description = sub_item.sub_description;
                        new_sub.qty = sub_item.qty;
                        new_sub.custom_net_weight = sub_item.custom_net_weight;
                        new_sub.base_rate = sub_item.base_rate;
                        new_sub.rate = sub_item.rate;
                        new_sub.amount = sub_item.amount;
                        new_sub.custom_freight__insurance_ = sub_item.custom_freight__insurance_;
                        // 🔽 Fetch Item weight_per_unit
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
                                    // Set unit weight
                                    new_sub.custom_unit_weight = weight;
                                    // Calculate net weight
                                    new_sub.custom_net_weight = flt(weight) * flt(new_sub.qty);
                                    if (res.message.customer_items && frm.doc.customer) {
                                        let matched_row = res.message.customer_items.find(row => 
                                            row.customer_name === frm.doc.customer
                                        );
                                        if (matched_row) {
                                            new_sub.customer_po_number = matched_row.ref_code;
                                        }
                                    }
                                }
                            }
                        });
                    }
                        calculate_sub_item_cif_values(frm, 'Delivery Note Sub Items', new_sub.name);
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

    let grouped = {};
    sub_items.forEach(sub => {
        let key = sub.parent_row_uid;
        if (!key) return;

        if (!grouped[key]) {
            grouped[key] = {
                rate_sum: 0,
                qty: null,
                has_qty: false,
                freight_pct: null,
                has_freight: false
            };
        }

        grouped[key].rate_sum += flt(sub.rate);

        if (!grouped[key].has_qty && (sub.qty || sub.qty === 0)) {
            grouped[key].qty = flt(sub.qty);
            grouped[key].has_qty = true;
        }

        if (!grouped[key].has_freight && (sub.custom_freight__insurance_ || sub.custom_freight__insurance_ === 0)) {
            grouped[key].freight_pct = flt(sub.custom_freight__insurance_);
            grouped[key].has_freight = true;
        }
    });

    let conversion_rate = flt(frm.doc.conversion_rate) || 1;

    (frm.doc.items || []).forEach(row => {
        let group = grouped[row.custom_row_uid];
        if (!group) return;

        let next_rate = group.rate_sum;
        let next_qty = group.has_qty ? group.qty : flt(row.qty);
        let next_freight = group.has_freight ? group.freight_pct : flt(row.custom_freight__insurance_);

        frappe.model.set_value(row.doctype, row.name, "rate", next_rate);

        if (group.has_qty) {
            frappe.model.set_value(row.doctype, row.name, "qty", next_qty);
        }

        if (group.has_freight) {
            frappe.model.set_value(row.doctype, row.name, "custom_freight__insurance_", next_freight);
        }

        let base_rate = next_rate * conversion_rate;
        let amount = next_rate * next_qty;

        frappe.model.set_value(row.doctype, row.name, "base_rate", base_rate);
        frappe.model.set_value(row.doctype, row.name, "amount", amount);

        calculate_cif_values(frm, row.doctype, row.name);
    });
}


function toggle_cif_total_by_currency(frm) {
    frm.toggle_display("custom_cif_total_amount_", false);
}


function toggle_sub_items_columns(frm) {
    if (!frm.fields_dict.custom_sub_items) return;

    const order_type = frm.doc.custom_order_type;

    let grid = frm.fields_dict.custom_sub_items.grid;
    let columns_to_show = [];

    if (order_type === "Export") {
        // Display columns for Export order type
        columns_to_show = [
            { fieldname: 'parent_item', columns: 1 },
            { fieldname: 'sub_item_code', columns: 2 },
            { fieldname: 'sub_description', columns: 2 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'custom_net_weight', columns: 1 },
        ];
    } else if (order_type === "Delivery Challan") {
        columns_to_show = [
            { fieldname: 'parent_item', columns: 2 },
            { fieldname: 'sub_item_code', columns: 2 },
            { fieldname: 'sub_description', columns: 2 },
            { fieldname: 'rate', columns: 1 },
            { fieldname: 'amount', columns: 1 },
        ];
    } else {
        // Reset to default columns for other order types
        columns_to_show = [];
    }

    try {
        let value = {};
        value[grid.doctype] = columns_to_show;

        frappe.model.user_settings.save(frm.doctype, 'GridView', value).then((r) => {
            frappe.model.user_settings[frm.doctype] = r.message || r;
            grid.reset_grid();
            frm.refresh_field("custom_sub_items");
        });

    } catch (e) {
        console.log("Error toggling sub-items columns:", e);
    }
}


/************************************
 * SHOW / HIDE EXPORT FIELDS (ITEMS)
 ************************************/
function toggle_export_fields(frm) {
    if (!frm.fields_dict.items) return;

    const order_type = frm.doc.custom_order_type;

    let grid = frm.fields_dict.items.grid;
    let columns_to_show = [];

    if (order_type === "Export") {
        columns_to_show = [
            { fieldname: 'custom_customer_order_number', columns: 1 },
            { fieldname: 'custom_sales_order_no', columns: 1 },
            { fieldname: 'item_code', columns: 2 },
            { fieldname: 'description', columns: 2 },
            { fieldname: 'qty', columns: 1 },
            { fieldname: 'total_weight', columns: 1 },
        ];
    } else if (order_type === "Delivery Challan") {
        columns_to_show = [
            { fieldname: 'item_code', columns: 2 },
            { fieldname: 'item_name', columns: 2 },
            { fieldname: 'description', columns: 2 },
            { fieldname: 'rate', columns: 1 },
            { fieldname: 'amount', columns: 1 },
        ];
    } else {
        // Default columns for other order types
        columns_to_show = [
            { fieldname: 'custom_customer_order_number', columns: 1 },
            { fieldname: 'custom_sales_order_no', columns: 1 },
            { fieldname: 'item_code', columns: 2 },
            { fieldname: 'description', columns: 2 },
            { fieldname: 'delivery_date', columns: 2 },
            { fieldname: 'amount', columns: 1 }
        ];
    }

    try {
        let value = {};
        value[grid.doctype] = columns_to_show;

        frappe.model.user_settings.save(frm.doctype, 'GridView', value).then((r) => {
            frappe.model.user_settings[frm.doctype] = r.message || r;
            grid.reset_grid();
            frm.refresh_field("items");
            hide_items_rows(frm);
            // Re-hide standard buttons and re-inject custom buttons after grid reset.
            // reset_grid() rebuilds the DOM, so both steps must run again.
            setup_items_grid_template_buttons(frm);
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
                frappe.model.set_value('Delivery Note Sub Items', sub.name, 'qty', parent_qty * base);
                updated = true;
            });

            if (updated) frm.refresh_field('custom_sub_items');
        }
    });
}

frappe.ui.form.on("Delivery Note Item", {
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
        // setTimeout(() => recalculate_dn_totals(frm), 150);
    },

    weight_per_unit(frm, cdt, cdn) {
        calculate_net_weight(frm, cdt, cdn);
        // setTimeout(() => recalculate_dn_totals(frm), 150);
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
            // if (old_uid) {
            //     let existing_sub_items = frm.doc.custom_sub_items || [];
            //     frm.doc.custom_sub_items = existing_sub_items.filter(function(sub) {
            //         return sub.parent_row_uid !== old_uid;
            //     });
            // }
            console.log("Fetching item details for:", row.item_code);

            frappe.call({
                method: 'frappe.client.get',
                args: {
                    doctype: 'Item',
                    name: row.item_code
                },
                callback: function(r) {
                    if (r.message && r.message.custom_sub_items && r.message.custom_sub_items.length > 0) {
                        console.log(r.message.custom_sub_items)
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


/************************************
 * DELIVERY NOTE SUB ITEM EVENTS
 ************************************/
frappe.ui.form.on("Delivery Note Sub Items", {
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
 * PARENT TOTALS: QTY + NET WEIGHT
 ************************************/
// function recalculate_dn_totals(frm) {
//     if (frm.doc.docstatus !== 0) return;
//     let total_qty = 0;
//     let total_net_weight = 0;
//     (frm.doc.items || []).forEach(row => {
//         if (row.item_code === "Bank Charges") return;
//         total_qty += flt(row.qty);
//         total_net_weight += flt(row.total_weight);
//     });
//     frm.set_value("total_qty", total_qty);
//     frm.set_value("total_net_weight", total_net_weight);
// }


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
            calculate_dn_cif_totals(frm);
        }, 100);
        return;
    }

    let base_rate = flt(row.base_rate);
    let rate = flt(row.rate);
    let qty = flt(row.qty);
    let freight_pct = flt(row.custom_freight__insurance_);

    // Company currency CIF
    let cif_unit_company = base_rate + (base_rate * freight_pct / 100);
    let cif_total_company = cif_unit_company * qty;

    // Order currency CIF
    let cif_unit_currency = rate + (rate * freight_pct / 100);
    let cif_total_currency = cif_unit_currency * qty;

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", cif_unit_company);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", cif_total_company);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", (freight_pct && freight_pct > 0) ? cif_unit_currency : 0);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", (freight_pct && freight_pct > 0) ? cif_total_currency : 0);

    // Recalculate totals after updating row values
    setTimeout(() => {
        calculate_dn_cif_totals(frm);
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

    // CIF calculations only for Export orders
    if (frm.doc.custom_order_type !== "Export") return;

    // Company currency CIF
    let cif_unit_company = base_rate + (base_rate * freight_pct / 100);
    let cif_total_company = cif_unit_company * qty;

    // Order currency CIF
    let cif_unit_currency = rate + (rate * freight_pct / 100);
    let cif_total_currency = cif_unit_currency * qty;

    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price", cif_unit_company);
    frappe.model.set_value(cdt, cdn, "custom__cif_total_amount", cif_total_company);
    frappe.model.set_value(cdt, cdn, "custom_cif_unit_price_", (freight_pct && freight_pct > 0) ? cif_unit_currency : 0);
    frappe.model.set_value(cdt, cdn, "custom___cif_total_amount", (freight_pct && freight_pct > 0) ? cif_total_currency : 0);
}


/************************************
 * DELIVERY NOTE TOTAL CIF
 ************************************/
function calculate_dn_cif_totals(frm) {
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

    frm.set_value("custom_cif_total_amount_company_currency", total_company);
    frm.set_value("custom_cif_total_amount_", total_currency);
    let conversion_rate = flt(frm.doc.conversion_rate) || 1;
    frm.set_value("custom_total_amount", total_item_amount);
    frm.set_value("custom_total_company_currency", total_item_amount * conversion_rate);
}


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


/* ===== COMMENTED OUT OLD CODE =====

/************************************
 * DELIVERY NOTE (PARENT)
 ************************************/
/*
frappe.ui.form.on("Delivery Note", {
    refresh(frm) {
        toggle_export_fields_dn(frm);
        toggle_cif_total_by_currency(frm);
    },

    custom_order_type(frm) {
        toggle_export_fields_dn(frm);
        calculate_so_cif_totals(frm);
    },

    currency(frm) {
        toggle_cif_total_by_currency(frm);
        calculate_so_cif_totals(frm);
    },

    validate(frm) {
        calculate_so_cif_totals(frm);
    },

    onload(frm) {
        toggle_export_fields_dn(frm);
    }
});


/************************************
 * SHOW / HIDE EXPORT FIELDS (ITEMS)
 ************************************/
/*
function toggle_export_fields_dn(frm) {
    if (!frm.fields_dict.items) return;

    const is_export = frm.doc.custom_order_type === "Export";

    const export_fields = [
        "custom_net_weight",
        "custom_cif_unit_price",
        "custom_cif_unit_price_",
        "custom_freight__insurance_",
        "custom__cif_total_amount",
        "custom___cif_total_amount"
    ];

    const grid = frm.fields_dict.items.grid;

    export_fields.forEach(fieldname => {
        // Form view (row popup)
        grid.update_docfield_property(
            fieldname,
            "hidden",
            is_export ? 0 : 1
        );

        // Grid list view
        grid.update_docfield_property(
            fieldname,
            "in_list_view",
            is_export ? 1 : 0
        );
    });

    // Refresh grid safely
    frm.refresh_field("items");
}


/************************************
 * DELIVERY NOTE ITEM EVENTS
 ************************************/
/*
frappe.ui.form.on("Delivery Note Item", {
    items_add(frm) {
        setTimeout(() => {
            toggle_export_fields_dn(frm);
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


/************************************
 * SHOW / HIDE CIF TOTAL BY CURRENCY
 ************************************/
/*
function toggle_cif_total_by_currency(frm) {
    const show = frm.doc.currency !== "INR";
    frm.toggle_display("custom_cif_total_amount_", show);
}


/************************************
 * ROW-LEVEL CIF CALCULATION
 ************************************/
/*
function calculate_cif_values(frm, cdt, cdn) {
    if (frm.doc.custom_order_type !== "Export") return;

    let row = locals[cdt][cdn];

    let base_rate = flt(row.base_rate);
    let rate = flt(row.rate);
    let qty = flt(row.qty);
    let freight_pct = flt(row.custom_freight__insurance_);

    // Company currency CIF
    let cif_unit_company =
        base_rate + (base_rate * freight_pct / 100);
    let cif_total_company = cif_unit_company * qty;

    // Order currency CIF
    let cif_unit_currency =
        rate + (rate * freight_pct / 100);
    let cif_total_currency = cif_unit_currency * qty;

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
        calculate_so_cif_totals(frm);
    }, 100);
}


/************************************
 * DELIVERY NOTE TOTAL CIF
 ************************************/
/*
function calculate_so_cif_totals(frm) {
    if (frm.doc.custom_order_type !== "Export") {
        frm.set_value(
            "custom_cif_total_amount_company_currency",
            0
        );
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
*/
