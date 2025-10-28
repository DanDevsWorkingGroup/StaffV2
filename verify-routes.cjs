// verify-routes.js
// Run with: node verify-routes.js

const fs = require('fs');
const path = require('path');

const routes = [
  { file: 'src/routes/_authed/index.tsx', expectedPath: "'/_authed/'" },
  { file: 'src/routes/_authed/dormitory/index.tsx', expectedPath: "'/_authed/dormitory/'" },
  { file: 'src/routes/_authed/events/index.tsx', expectedPath: "'/_authed/events/'" },
  { file: 'src/routes/_authed/events/create.tsx', expectedPath: "'/_authed/events/create'" },
  { file: 'src/routes/_authed/events/$id.tsx', expectedPath: "'/_authed/events/$id'" },
  { file: 'src/routes/_authed/physical-training/index.tsx', expectedPath: "'/_authed/physical-training/'" },
  { file: 'src/routes/_authed/religious-activity/index.tsx', expectedPath: "'/_authed/religious-activity/'" },
  { file: 'src/routes/_authed/schedule/index.tsx', expectedPath: "'/_authed/schedule/'" },
  { file: 'src/routes/_authed/trainer-overview/index.tsx', expectedPath: "'/_authed/trainer-overview/'" },
];

console.log('🔍 Verifying Route Files...\n');

let allCorrect = true;

routes.forEach(({ file, expectedPath }) => {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/createFileRoute\(([^)]+)\)/);
    
    if (!match) {
      console.log(`❌ ${file}`);
      console.log(`   Missing createFileRoute declaration\n`);
      allCorrect = false;
      return;
    }

    const actualPath = match[1];
    
    if (actualPath === expectedPath) {
      console.log(`✅ ${file}`);
      console.log(`   Route path: ${actualPath}\n`);
    } else {
      console.log(`❌ ${file}`);
      console.log(`   Expected: ${expectedPath}`);
      console.log(`   Found: ${actualPath}\n`);
      allCorrect = false;
    }
  } catch (error) {
    console.log(`❌ ${file}`);
    console.log(`   File not found or cannot be read\n`);
    allCorrect = false;
  }
});

if (allCorrect) {
  console.log('🎉 All route paths are correct!');
} else {
  console.log('⚠️  Some route paths need to be fixed.');
  console.log('\n📝 Fix instructions:');
  console.log('1. Open each file marked with ❌');
  console.log('2. Find the createFileRoute() line');
  console.log('3. Replace the path with the expected value shown above');
  console.log('4. Save the file');
  console.log('5. Run this script again to verify');
}

console.log('\n💡 Tip: After fixing, run `npm run dev` to test the application');