'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, expect } = require('../fixtures');

const repoRoot = path.join(__dirname, '../..');

test('test launcher accepts an externally managed database without wslc', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autotaskcalendar-launcher-'));
    const invocationFile = path.join(tempDir, 'npx-invocation.json');
    const mockNpx = path.join(tempDir, 'npx');
    const mockNpm = path.join(tempDir, 'npm');
    const externalMongoUrl = 'mongodb://127.0.0.1:27017/autotaskcalendar_launcher_test';
    const ambientMongoUrl = 'mongodb://127.0.0.1:27018/autotaskcalendar_dev';

    fs.writeFileSync(
        mockNpx,
        [
            `#!${process.execPath}`,
            "'use strict';",
            `require('fs').writeFileSync(${JSON.stringify(invocationFile)}, JSON.stringify({`,
            '    args: process.argv.slice(2),',
            '    mongoUrl: process.env.AUTOTASKCALENDAR_MONGO_URL,',
            '}));',
        ].join('\n')
    );
    fs.chmodSync(mockNpx, 0o755);
    fs.writeFileSync(mockNpm, `#!${process.execPath}\nprocess.exit(99);\n`);
    fs.chmodSync(mockNpm, 0o755);

    const env = {
        ...process.env,
        PATH: tempDir,
        AUTOTASKCALENDAR_TEST_INSTANCE: 'launcher-regression',
        AUTOTASKCALENDAR_MONGO_URL: ambientMongoUrl,
        AUTOTASKCALENDAR_TEST_MONGO_URL: externalMongoUrl,
        AUTOTASKCALENDAR_TEST_BUILD: '0',
    };

    const result = spawnSync(process.execPath, ['scripts/test.js', '--project=api'], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        timeout: 10_000,
    });

    try {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('database   externally managed');
        expect(result.stderr).not.toContain("'wslc' not found");
        expect(JSON.parse(fs.readFileSync(invocationFile, 'utf8'))).toEqual({
            args: ['playwright', 'test', '--project=api'],
            mongoUrl: externalMongoUrl,
        });
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
