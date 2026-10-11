$ExpectedDatabaseName = 'skin_goddes_finance_test'
$ExpectedDbHost = '::1'
$ExpectedDbPort = '5432'
$ExpectedServerPort = 5432

$previousDbName = $env:DB_NAME
$previousDbHost = $env:DB_HOST
$previousLocation = Get-Location
$previousErrorActionPreference = $ErrorActionPreference

try {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Users\Ron\OneDrive - STI College Las Pinas\Desktop\Capstone2026\Cursor\Website'
    $env:DB_NAME = $ExpectedDatabaseName
    $env:DB_HOST = $ExpectedDbHost

    $configCode = "require('dotenv').config(); const password = process.env.SEED_AESTHETICIAN_PASSWORD; process.stdout.write('PREFLIGHT_CONFIG:' + JSON.stringify({ DB_HOST: process.env.DB_HOST || null, DB_PORT: process.env.DB_PORT || null, seedPasswordConfigured: typeof password === 'string' && password.trim().length > 0 }) + '\n');"
    $configOutput = & node -e $configCode 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not read effective project configuration.'
    }

    $configJson = $null
    foreach ($line in $configOutput) {
        if ([string]$line -match 'PREFLIGHT_CONFIG:(\{.*\})') {
            $configJson = $Matches[1]
        }
    }
    if ($null -eq $configJson) {
        throw 'Could not locate the project configuration result; no database connection was attempted.'
    }

    $projectConfig = $configJson | ConvertFrom-Json
    Write-Host "Effective DB_HOST=$($projectConfig.DB_HOST); DB_PORT=$($projectConfig.DB_PORT)"
    Write-Host "SEED_AESTHETICIAN_PASSWORD configured: $($projectConfig.seedPasswordConfigured)"

if ([string]::IsNullOrWhiteSpace([string]$projectConfig.DB_HOST) -or [string]::IsNullOrWhiteSpace([string]$projectConfig.DB_PORT))  {
        throw 'Effective DB_HOST or DB_PORT is missing; no database connection was attempted.'
    }
    if ($projectConfig.DB_HOST -cne $ExpectedDbHost) {
        throw 'Effective DB_HOST differs from the expected value; no database connection was attempted.'
    }
    if ([string]$projectConfig.DB_PORT -cne $ExpectedDbPort) {
        throw 'Effective DB_PORT differs from the expected value; no database connection was attempted.'
    }

    $ExpectedServerAddress = Read-Host 'Enter the independently approved server address exactly as inet_server_addr()::text should return it'
    if ([string]::IsNullOrWhiteSpace($ExpectedServerAddress)) {
        throw 'An independently verified expected server address is required.'
    }

    $inspectionScript = @'
const output = console.log.bind(console);
console.log = () => {};
console.error = () => {};

const safeErrorMessage = (error) => {
  let message = error && typeof error.message === 'string'
    ? error.message
    : 'Unknown error';

  for (const key of [
    'DB_PASSWORD',
    'SEED_AESTHETICIAN_PASSWORD',
    'DB_USER',
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_SSL',
    'DATABASE_URL',
    'PGPASSWORD',
    'PGUSER',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
  ]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      message = message.split(value).join(`[${key} redacted]`);
    }
  }

  message = message
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s"'<>]+/gi, '[connection string redacted]')
    .replace(/\b(password|passwd|pwd|username|user|host|port|dbname|database|sslmode)\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/(password authentication failed for user)\s+"[^"]+"/gi, '$1 [redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);

  const code = error && typeof error.code === 'string'
    && /^[A-Z0-9_]{1,20}$/.test(error.code)
    ? `${error.code}: `
    : '';
  return `${code}${message}`;
};

(async () => {
  let db;
  let report;
  let failed = false;

  try {
    db = require('./db');

    const identityResult = await db.query(`
      SELECT current_database() AS database,
             current_schema() AS schema,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port
    `);

    const extensionResult = await db.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'
        ) AS btree_gist_installed,
        EXISTS (
          SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist'
        ) AS btree_gist_available,
        has_database_privilege(
          current_user,
          current_database(),
          'CREATE'
        ) AS database_create_privilege,
        COALESCE(
          (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
          FALSE
        ) AS current_role_is_superuser
    `);

    const requiredSchema = {
      users: [
        'user_id', 'email', 'password_hash', 'first_name', 'last_name',
        'email_verified', 'role', 'status',
      ],
      services: [
        'service_id', 'service_name', 'category', 'duration_minutes',
        'service_price', 'reservation_fee', 'is_active',
      ],
      appointments: [
        'appointment_id', 'user_id', 'service_id', 'booked_service_price',
        'booked_reservation_fee', 'payment_status', 'appointment_date',
        'appointment_time', 'appointment_end_time', 'appointment_status',
        'aesthetician_id',
      ],
      inventory_products: [
        'product_id', 'product_name', 'category', 'stock_quantity',
        'unit_price', 'updated_at',
      ],
      inventory_transactions: [
        'transaction_id', 'product_id', 'product_name', 'transaction_type',
        'quantity', 'previous_stock', 'new_stock', 'created_by', 'created_at',
      ],
      paymongo_checkout_sessions: [
        'reference_number', 'appointment_id', 'created_at',
      ],
      payments: [
        'payment_id', 'appointment_id', 'payment_type', 'amount', 'method',
        'reference_no', 'note', 'recorded_by', 'status', 'created_at',
      ],
      expenses: [
        'expense_id', 'expense_date', 'category', 'description', 'amount',
        'supplier', 'reference_no', 'recorded_by', 'created_at', 'voided_at',
      ],
      notifications: [
        'notification_id', 'user_id', 'type', 'message', 'is_read', 'created_at',
      ],
      payment_reversals: [
        'reversal_id', 'payment_id', 'reason', 'reversed_by', 'reversed_at',
      ],
      product_sale_details: [
        'payment_id', 'product_id', 'product_name', 'quantity',
        'unit_price', 'request_key', 'created_at',
      ],
      inventory_purchase_batches: [
        'purchase_batch_id', 'request_key', 'payload_hash', 'created_by', 'created_at',
      ],
      inventory_purchase_records: [
        'purchase_id', 'purchase_batch_id', 'row_number',
        'inventory_transaction_id', 'product_id', 'product_name',
        'quantity', 'unit_price', 'purchase_date', 'expense_id',
        'reviewed_by', 'reviewed_at', 'created_at',
      ],
      cash_closings: [
        'cash_closing_id', 'business_date', 'expected_amount',
        'actual_amount', 'variance', 'closed_by', 'created_at', 'closed_at',
      ],
    };

    const tablePhase = {
      users: '000-init-schema',
      services: '000-init-schema',
      appointments: '000-init-schema',
      inventory_products: '004-inventory',
      inventory_transactions: '004-inventory',
      paymongo_checkout_sessions: '007-paymongo-checkouts',
      payments: '021-finance',
      expenses: '021-finance',
      notifications: '015-notifications',
      payment_reversals: '030-payment-reversals',
      product_sale_details: '031-finance-product-sales-purchases',
      inventory_purchase_batches: '031-finance-product-sales-purchases',
      inventory_purchase_records: '031-finance-product-sales-purchases',
      cash_closings: '032-finance-dashboard-cash-closing',
    };

    const requiredTables = Object.keys(requiredSchema);
    const tableResult = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [requiredTables]);

    const presentTables = new Set(tableResult.rows.map((row) => row.table_name));
    const requiredTablesMissing = requiredTables
      .filter((table) => !presentTables.has(table))
      .map((table) => ({
        table,
        introducedBy: tablePhase[table],
        interpretation: 'May be expected before its migration; partial migration or schema drift is also possible.',
      }));

    const columnResult = await db.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `, [requiredTables]);

    const presentColumns = new Set(
      columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`)
    );
    const requiredColumnsMissing = [];

    for (const [table, columns] of Object.entries(requiredSchema)) {
      if (!presentTables.has(table)) continue;
      for (const column of columns) {
        if (!presentColumns.has(`${table}.${column}`)) {
          requiredColumnsMissing.push({
            table,
            column,
            interpretation: 'May be expected before its migration; partial migration or schema drift is also possible.',
          });
        }
      }
    }

    const has = (table, column) => presentColumns.has(`${table}.${column}`);
    const appointmentData = {
      migration001ActiveStatuses: ['confirmed', 'completed'],
      statusCounts: null,
      unexpectedStatuses: null,
      unresolvableServiceRows: null,
      nullAppointmentEndTimeRows: null,
      confirmedWithoutAestheticianRows: null,
      confirmedWithoutAestheticianCheckStatus: {
        status: 'inconclusive',
        missingTables: [],
        missingColumns: [],
      },
      invalidActiveEndTimeCount: null,
      invalidActiveEndTimeExamples: null,
      invalidEndTimeCheckStatus: 'inconclusive',
      overlapCheck: {
        status: 'inconclusive',
        reason: 'Required appointment/service tables or columns are unavailable.',
        overlappingPairs: null,
      },
    };

    if (presentTables.has('appointments') && has('appointments', 'appointment_status')) {
      const statusResult = has('appointments', 'payment_status')
        ? await db.query(`
            SELECT appointment_status::text AS appointment_status,
                   payment_status::text AS payment_status,
                   COUNT(*)::int AS count
            FROM appointments
            GROUP BY appointment_status, payment_status
            ORDER BY appointment_status, payment_status
          `)
        : await db.query(`
            SELECT appointment_status::text AS appointment_status,
                   NULL::text AS payment_status,
                   COUNT(*)::int AS count
            FROM appointments
            GROUP BY appointment_status
            ORDER BY appointment_status
          `);

      const knownStatuses = new Set([
        'pending', 'confirmed', 'completed', 'cancelled', 'no_show',
      ]);
      appointmentData.statusCounts = statusResult.rows;
      appointmentData.unexpectedStatuses = [
        ...new Set(statusResult.rows
          .map((row) => row.appointment_status)
          .filter((status) => !knownStatuses.has(status))),
      ];

    }

    const missingAestheticianCheckTables = presentTables.has('appointments')
      ? []
      : ['appointments'];
    const missingAestheticianCheckColumns = [
      ['appointment_status', has('appointments', 'appointment_status')],
      ['aesthetician_id', has('appointments', 'aesthetician_id')],
    ]
      .filter(([, present]) => !present)
      .map(([column]) => `appointments.${column}`);

    if (
      missingAestheticianCheckTables.length === 0
      && missingAestheticianCheckColumns.length === 0
    ) {
      const confirmed = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM appointments
        WHERE appointment_status = 'confirmed'
          AND aesthetician_id IS NULL
      `);

      appointmentData.confirmedWithoutAestheticianRows = confirmed.rows[0].count;
      appointmentData.confirmedWithoutAestheticianCheckStatus = {
        status: 'checked',
        missingTables: [],
        missingColumns: [],
      };
    } else {
      appointmentData.confirmedWithoutAestheticianCheckStatus = {
        status: 'inconclusive',
        missingTables: missingAestheticianCheckTables,
        missingColumns: missingAestheticianCheckColumns,
      };
    }

    const canCheckServiceBackfill = presentTables.has('appointments')
      && presentTables.has('services')
      && has('appointments', 'service_id')
      && has('services', 'service_id')
      && has('services', 'duration_minutes');

    if (canCheckServiceBackfill) {
      const unresolved = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM appointments appointment
        LEFT JOIN services service_record
          ON service_record.service_id = appointment.service_id
        WHERE service_record.service_id IS NULL
           OR service_record.duration_minutes IS NULL
      `);
      appointmentData.unresolvableServiceRows = unresolved.rows[0].count;
    }

    if (presentTables.has('appointments') && has('appointments', 'appointment_end_time')) {
      const nullEndTime = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM appointments
        WHERE appointment_end_time IS NULL
      `);
      appointmentData.nullAppointmentEndTimeRows = nullEndTime.rows[0].count;
    }

    const invalidEndTimeColumns = [
      ['appointment_id', has('appointments', 'appointment_id')],
      ['appointment_date', has('appointments', 'appointment_date')],
      ['appointment_status', has('appointments', 'appointment_status')],
      ['appointment_time', has('appointments', 'appointment_time')],
      ['appointment_end_time', has('appointments', 'appointment_end_time')],
    ];
    const missingInvalidEndTimeColumns = invalidEndTimeColumns
      .filter(([, present]) => !present)
      .map(([column]) => column);

    if (presentTables.has('appointments') && missingInvalidEndTimeColumns.length === 0) {
      const invalidCount = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM appointments
        WHERE appointment_status IN ('confirmed', 'completed')
          AND appointment_end_time IS NOT NULL
          AND appointment_end_time <= appointment_time
      `);

      const invalidExamples = await db.query(`
        SELECT appointment_id,
               appointment_date::text AS appointment_date,
               appointment_status::text AS appointment_status,
               appointment_time::text AS appointment_time,
               appointment_end_time::text AS appointment_end_time
        FROM appointments
        WHERE appointment_status IN ('confirmed', 'completed')
          AND appointment_end_time IS NOT NULL
          AND appointment_end_time <= appointment_time
        ORDER BY appointment_date, appointment_id
        LIMIT 20
      `);

      appointmentData.invalidActiveEndTimeCount = invalidCount.rows[0].count;
      appointmentData.invalidActiveEndTimeExamples = invalidExamples.rows;
      appointmentData.invalidEndTimeCheckStatus = 'checked';
    } else {
      appointmentData.invalidEndTimeCheckStatus = {
        status: 'inconclusive',
        missingTables: presentTables.has('appointments') ? [] : ['appointments'],
        missingColumns: missingInvalidEndTimeColumns,
      };
    }

    const overlapRequiredColumns = [
      ['appointments', 'appointment_id'],
      ['appointments', 'aesthetician_id'],
      ['appointments', 'appointment_date'],
      ['appointments', 'appointment_time'],
      ['appointments', 'appointment_status'],
      ['appointments', 'appointment_end_time'],
      ['appointments', 'service_id'],
      ['services', 'service_id'],
      ['services', 'duration_minutes'],
    ];
    const missingOverlapColumns = overlapRequiredColumns
      .filter(([table, column]) => !presentTables.has(table) || !has(table, column))
      .map(([table, column]) => `${table}.${column}`);

    if (missingOverlapColumns.length) {
      appointmentData.overlapCheck = {
        status: 'inconclusive',
        reason: `Cannot check overlap constraint inputs: ${missingOverlapColumns.join(', ')}`,
        overlappingPairs: null,
      };
    } else {
      const overlaps = await db.query(`
        SELECT COUNT(*)::int AS count
        FROM appointments a
        JOIN services sa ON sa.service_id = a.service_id
        JOIN appointments b
          ON b.appointment_id > a.appointment_id
         AND b.aesthetician_id = a.aesthetician_id
        JOIN services sb ON sb.service_id = b.service_id
        WHERE a.aesthetician_id IS NOT NULL
          AND b.aesthetician_id IS NOT NULL
          AND a.appointment_status IN ('confirmed', 'completed')
          AND b.appointment_status IN ('confirmed', 'completed')
          AND (a.appointment_date + a.appointment_time)
              < (b.appointment_date + b.appointment_end_time)
          AND (b.appointment_date + b.appointment_time)
              < (a.appointment_date + a.appointment_end_time)
      `);

      const hasInvalidEndTimes =
        Number(appointmentData.invalidActiveEndTimeCount || 0) > 0;

      appointmentData.overlapCheck = {
        status: hasInvalidEndTimes
          ? 'partial: invalid active end times may affect this count'
          : (appointmentData.unexpectedStatuses?.length
            ? 'checked for migration 001 active statuses; unexpected statuses reported separately'
            : 'checked for migration 001 active statuses'),
        reason: hasInvalidEndTimes
          ? 'Resolve invalid active end times before interpreting overlap results.'
          : null,
        overlappingPairs: overlaps.rows[0].count,
      };
    }

    const ledgerResult = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name ILIKE '%migration%'
      ORDER BY table_name
    `);

    const missingBaselineTables = requiredTablesMissing
      .filter(({ table }) => ['users', 'services', 'appointments'].includes(table));
    const schemaReadiness = requiredTablesMissing.length || requiredColumnsMissing.length
      ? 'incomplete_or_inconclusive'
      : 'required_list_present';

    report = {
      ok: true,
      preflightExecution: 'completed',
      schemaReadiness,
      schemaReadinessNote: 'Missing objects may be expected before migrations; without a reliable migration ledger, this check cannot distinguish an unmigrated database from partial application or schema drift.',
      identity: identityResult.rows[0],
      extension: extensionResult.rows[0],
      requiredTablesMissing,
      requiredColumnsMissing,
      missingBaselineTables,
      migrationHistoryTableCandidates: ledgerResult.rows.map((row) => row.table_name),
      appointmentData,
      readOnlyQueriesOnly: true,
    };
  } catch (error) {
    failed = true;
    report = {
      ok: false,
      preflightExecution: 'failed',
      message: safeErrorMessage(error),
    };
  } finally {
    if (db) {
      try {
        await db.pool.end();
      } catch (error) {
        failed = true;
        report = {
          ok: false,
          preflightExecution: 'failed',
          message: `Connection cleanup failed: ${safeErrorMessage(error)}`,
        };
      }
    }
  }

  output(JSON.stringify(report));
  if (failed) process.exitCode = 1;
})();
'@

    $reportJson = $inspectionScript | node 2>$null
    $nodeExitCode = $LASTEXITCODE
    try {
        $report = $reportJson | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        if ($nodeExitCode -ne 0) {
            throw "Read-only PostgreSQL preflight failed before Node.js produced a safe diagnostic report (exit code $nodeExitCode)."
        }
        throw 'Read-only PostgreSQL preflight returned invalid diagnostic JSON.'
    }

    Write-Host 'Read-only preflight report:'
    $report | ConvertTo-Json -Depth 10 | Write-Host

    if (-not $report.ok) {
        throw "Read-only PostgreSQL preflight failed: $($report.message)"
    }
    if ($nodeExitCode -ne 0) {
        throw "Read-only PostgreSQL preflight exited with code $nodeExitCode despite reporting success."
    }
    if ($report.identity.database -cne $ExpectedDatabaseName) {
        throw 'Connected database is not exactly skin_goddes_finance_test.'
    }
    if ($report.identity.server_address -cne $ExpectedServerAddress) {
        throw 'Actual server address differs from the independently supplied expected value.'
    }
    if ([int]$report.identity.server_port -ne $ExpectedServerPort) {
        throw 'Actual PostgreSQL server port differs from the expected port.'
    }
    if ([int]$report.identity.server_port -ne [int]$projectConfig.DB_PORT) {
        throw 'Actual PostgreSQL server port differs from effective DB_PORT.'
    }

    Write-Host 'Identity checks passed. No migration, seed, DDL, or DML command was run.'
}
finally {
    try {
        if ($null -eq $previousDbName) {
            Remove-Item Env:DB_NAME -ErrorAction SilentlyContinue
        }
        else {
            $env:DB_NAME = $previousDbName
        }
    }
    finally {
        try {
            if ($null -eq $previousDbHost) {
                Remove-Item Env:DB_HOST -ErrorAction SilentlyContinue
            }
            else {
                $env:DB_HOST = $previousDbHost
            }
        }
        finally {
            try {
                Set-Location $previousLocation
            }
            finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
        }
    }
}