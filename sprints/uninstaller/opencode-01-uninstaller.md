# Sprint: OpenCode Uninstaller Feature

## Problem Statement
Users need a reliable way to completely remove OpenCode from their system, including all configuration files, cached data, and installed components, as outlined in [Issue #3900](https://github.com/sst/opencode/issues/3900).

## Context
### Existing System
OpenCode is a CLI tool that installs various components and configurations across the system. Currently, there is no comprehensive uninstall command that cleanly removes all traces of the installation.

### Uninstaller Feature Requirements
The uninstaller must provide a complete removal process that:
- Removes the OpenCode binary/executable
- Cleans up configuration files from user directories
- Removes cached data and temporary files
- Provides options for selective removal (keep configs, etc.)
- Confirms actions before destructive operations

## Success Criteria
- [ ] Uninstall command (`opencode uninstall`) is available in the CLI
- [ ] Command removes OpenCode executable from installation path
- [ ] Configuration files in ~/.opencode are removed (with --all flag)
- [ ] Cache directories are cleaned up
- [ ] User is prompted for confirmation before removal
- [ ] Option to keep configuration files (--keep-config)
- [ ] Uninstaller provides clear feedback on what was removed
- [ ] Process is reversible by reinstalling OpenCode
- [ ] Exit code 0 on successful uninstallation
- [ ] Comprehensive error handling for permission issues
- [ ] Documentation updated with uninstall instructions

## Technical Requirements

### CLI Interface
```bash
opencode uninstall [options]
  --all           Remove everything including configs
  --keep-config   Keep configuration files
  --force         Skip confirmation prompts
  --dry-run       Show what would be removed without doing it
```

### File Locations to Handle
- **Binary**: `/usr/local/bin/opencode` or installation path
- **Config**: `~/.opencode/` directory
- **Cache**: `~/.cache/opencode/` directory
- **Temp**: `/tmp/opencode-*` files
- **Logs**: `~/.opencode/logs/` directory

### Implementation Steps
1. Parse command arguments and flags
2. Identify all OpenCode-related files and directories
3. Show user what will be removed (with confirmation)
4. Remove files in correct order (temp -> cache -> config -> binary)
5. Verify removal and report status
6. Clean up any remaining symlinks or PATH entries

### Error Handling
- Permission denied errors should suggest using sudo
- Missing files should not cause failure
- Partial uninstall should be reported clearly
- Network operations should have timeout handling

## Testing Strategy
1. Install OpenCode in a test container
2. Create configuration and cache files
3. Run uninstall command with various flags
4. Verify complete removal of all components
5. Test edge cases (permissions, missing files, etc.)
6. Validate that reinstallation works after uninstall

## Validation Checklist
- [ ] Binary file removed from system
- [ ] Config directory removed (when using --all)
- [ ] Cache directory cleaned up
- [ ] No orphaned files remain
- [ ] PATH environment cleaned if modified
- [ ] Exit codes match expected values
- [ ] Help text includes uninstall command
- [ ] Man page or docs updated