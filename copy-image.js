const fs = require('fs');

const sourceDir = 'C:/Users/venee/AppData/Roaming/Code/User/globalStorage/github.copilot-chat/copilot-cli-images';
const destDir = 'C:/Users/venee/Desktop/HER.worktrees/copilot-worktree-2026-05-01T08-55-27/public/her';

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(
  sourceDir + '/1777627833804-7pqi3py4.png',
  destDir + '/reference.png'
);

const stats = fs.statSync(destDir + '/reference.png');
console.log('done', stats.size);
