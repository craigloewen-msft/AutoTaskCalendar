/**
 * Simple test to verify the website structure and build process
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Starting website build test...\n');

let exitCode = 0;

// Test 1: Check required files exist
console.log('Test 1: Checking required files...');
const requiredFiles = [
  'app.js',
  'package.json',
  'webinterface/package.json',
  'webinterface/src',
  'webinterface/public'
];

for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.error(`✗ ERROR: Required file/directory missing: ${file}`);
    exitCode = 1;
  } else {
    console.log(`✓ ${file} exists`);
  }
}

// Test 2: Validate JavaScript syntax in main app
console.log('\nTest 2: Validating JavaScript syntax...');
try {
  // Try to load app.js to check for syntax errors
  // Note: This may have side effects if app.js executes code at module level
  require('./app.js');
  console.log('✓ app.js syntax is valid');
} catch (error) {
  // Only fail on syntax errors, not runtime errors
  if (error instanceof SyntaxError) {
    console.error('✗ ERROR: Syntax error in app.js');
    console.error(error.message);
    exitCode = 1;
  } else {
    // Runtime errors during import are expected since we're not setting up the environment
    console.log('✓ app.js syntax is valid (runtime initialization skipped)');
  }
}

// Test 3: Run the build process
console.log('\nTest 3: Running build process...');
try {
  execSync('npm run build', { 
    stdio: 'inherit',
    cwd: __dirname,
    timeout: 180000 // 3 minute timeout for build process
  });

  // Check if the dist directory was created
  const distPath = path.join(__dirname, 'dist');
  if (!fs.existsSync(distPath)) {
    console.error('\n✗ ERROR: dist directory was not created');
    exitCode = 1;
  } else {
    const distFiles = fs.readdirSync(distPath);
    if (distFiles.length === 0) {
      console.error('\n✗ ERROR: dist directory is empty');
      exitCode = 1;
    } else {
      console.log(`\n✓ Build successful - dist directory created with ${distFiles.length} files/directories`);
    }
  }
} catch (error) {
  console.error('\n✗ ERROR: Build process failed');
  console.error(error.message);
  exitCode = 1;
}

// Final result
console.log('\n' + '='.repeat(50));
if (exitCode === 0) {
  console.log('✓ All tests passed - website is in good state');
} else {
  console.log('✗ Some tests failed - website has issues');
}
console.log('='.repeat(50));

process.exit(exitCode);
