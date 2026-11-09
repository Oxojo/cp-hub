const { DISCORD_APPLICATION_ID: app, DISCORD_GUILD_ID: guild, DISCORD_BOT_TOKEN: token } = process.env;
if (!app || !guild || !token) throw new Error('Configure DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN');
const commands = ['setup', 'today', 'progress', 'problems', 'review', 'contests'].map(name => ({ name, description: `CP Hub: ${name}`, type: 1 }));
commands.push({ name: 'add', description: '問題 URL を候補に追加', options: [{ name: 'url', description: 'Problem URL', type: 3, required: true }] });
commands.push({ name: 'ストックに追加', type: 3 });
const response = await fetch(`https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`, { method: 'PUT', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Command registration HTTP ${response.status}`);
console.log('Registered CP Hub guild commands.');
