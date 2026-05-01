const fs = require('fs');
const path = require('path');

const workdir = __dirname;

// Create first directory
const dir1 = path.join(workdir, 'src', 'app', 'api', 'imagine', 'auto');
try {
  fs.mkdirSync(dir1, { recursive: true });
  console.log('✓ Directory 1 created: ' + dir1);
} catch (e) {
  console.log('✗ Failed to create directory 1: ' + e.message);
}

// Create second directory
const dir2 = path.join(workdir, 'public', 'her');
try {
  fs.mkdirSync(dir2, { recursive: true });
  console.log('✓ Directory 2 created: ' + dir2);
} catch (e) {
  console.log('✗ Failed to create directory 2: ' + e.message);
}

// Copy file
const source = 'C:\\Users\\venee\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\copilot-cli-images\\1777627833804-7pqi3py4.png';
const destination = path.join(dir2, 'reference.png');

try {
  fs.copyFileSync(source, destination);
  console.log('✓ File copied: ' + destination);
} catch (e) {
  console.log('✗ Failed to copy file: ' + e.message);
}

// Verify
const dir1Exists = fs.existsSync(dir1);
const dir2Exists = fs.existsSync(dir2);
const fileExists = fs.existsSync(destination);

console.log('');
console.log('Verification:');
console.log('Directory 1 exists: ' + dir1Exists);
console.log('Directory 2 exists: ' + dir2Exists);
console.log('File exists: ' + fileExists);

if (dir1Exists && dir2Exists && fileExists) {
  console.log('');
  console.log('✓✓✓ SUCCESS: All operations completed successfully ✓✓✓');
  process.exit(0);
} else {
  console.log('');
  console.log('✗✗✗ FAILURE: Some operations did not complete ✗✗✗');
  process.exit(1);
}
