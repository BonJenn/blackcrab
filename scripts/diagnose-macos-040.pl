#!/usr/bin/perl
# Read-only diagnostics for the immutable Blackcrab 0.4.0 Mac release.
# Does not launch the app, extract archives, repair permissions, or read sessions.
use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use Fcntl qw(:DEFAULT :flock :mode);
use File::Spec;
use JSON::PP;

my $app = '/Applications/Blackcrab.app';
my $data = File::Spec->catdir($ENV{HOME} // '', 'Library', 'Application Support', 'com.bonjenn.blackcrab');
while (@ARGV) {
    my $option = shift @ARGV;
    die "Usage: perl diagnose-macos-040.pl [--app /path/Blackcrab.app] [--data /path/app-data]\n"
        unless @ARGV && ($option eq '--app' || $option eq '--data');
    my $value = shift @ARGV;
    die "Expected an absolute path without parent traversal\n"
        unless File::Spec->file_name_is_absolute($value) && !grep { $_ eq '..' } File::Spec->splitdir($value);
    if ($option eq '--app') { $app = $value; } else { $data = $value; }
}
alarm 120;
my @checks;
my $report = {
    scope => 'Read-only Blackcrab 0.4.0 installation and cache diagnostics',
    app => $app, data => $data, effectiveUid => 0 + $>, checks => \@checks,
    appLaunched => JSON::PP::false, filesModified => JSON::PP::false,
};
sub check {
    my ($name, $passed, $detail) = @_;
    push @checks, { name => $name, passed => $passed ? JSON::PP::true : JSON::PP::false, detail => $detail };
}
sub metadata {
    my ($name, $path, $kind) = @_;
    my @s = lstat $path;
    unless (@s) { check($name, 0, "Cannot inspect: $!"); return; }
    my $ok = $kind eq 'directory' ? S_ISDIR($s[2]) : S_ISREG($s[2]);
    check($name, $ok, { kind => S_ISLNK($s[2]) ? 'symlink' : S_ISDIR($s[2]) ? 'directory' : S_ISREG($s[2]) ? 'file' : 'other',
        mode => sprintf('%04o', $s[2] & 07777), uid => $s[4], links => $s[3], bytes => $s[7] });
    return $ok ? \@s : undef;
}
sub hash_file {
    my ($name, $path, $expected) = @_;
    return unless metadata("$name file", $path, 'file');
    unless (sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW)) {
        check("$name readable", 0, "Cannot open: $!"); return;
    } else {
        binmode $fh;
        my $sha = Digest::SHA->new(256);
        eval { $sha->addfile($fh); 1 } or do { check("$name digest", 0, 'Read failed'); close $fh; return; };
        close $fh;
        my $actual = $sha->hexdigest;
        check("$name matches published 0.4.0", $actual eq $expected, $actual);
    }
}
hash_file('Executable', "$app/Contents/MacOS/blackcrab", '4f964a7daa50f4b794da504254c4bcd95627969f850a4f26bfd00a4ebdbd88d7');
hash_file('Desktop archive', "$app/Contents/Resources/managed-desktop-payload.tar.gz", 'a47244cfd3bc3c7f5a72fb160c58e5e93c9d6b3b9e56d35439bea92471a7c270');
hash_file('Host archive', "$app/Contents/Resources/managed-host-payload.tar.gz", 'e688f57832696abdf5159df5e24995e275c6dbf02304797854c036ae6b683156');

my $cache = "$data/managed-payloads-v1";
my $prefix = '/';
my @links;
for my $part (File::Spec->splitdir($cache)) {
    next if $part eq '';
    $prefix = File::Spec->catdir($prefix, $part);
    my @s = lstat $prefix;
    push @links, $prefix if @s && S_ISLNK($s[2]);
}
check('Cache path has no symlink ancestors', !@links, \@links);
my $parent = metadata('App data', $data, 'directory');
check('App data owner and permissions', $parent && $parent->[4] == $> && !($parent->[2] & 0022), 'Requires current user ownership and no group/other write');
my $cache_meta = metadata('Payload cache', $cache, 'directory');
check('Cache owner and permissions', $cache_meta && $cache_meta->[4] == $> && !($cache_meta->[2] & 0077), 'Requires current user ownership and private permissions');

my $marker_path = "$cache/.blackcrab-managed-payload-cache-v1";
my $marker = metadata('Cache marker', $marker_path, 'file');
check('Marker ownership and links', $marker && $marker->[4] == $> && $marker->[3] == 1 && !($marker->[2] & 0077), 'Requires current user, one link and private permissions');
if ($marker && $marker->[7] <= 64 && sysopen(my $fh, $marker_path, O_RDONLY | O_NOFOLLOW)) {
    my $value = '';
    my $read = sysread($fh, $value, 65);
    close $fh;
    check('Marker contents recognized', defined($read) && $value eq "blackcrab-payload-cache-v1\n", 'Only compares the public fixed cache marker; contents are not printed');
} else { check('Marker contents recognized', 0, 'Marker is absent, oversized or unreadable'); }

my $key = substr(sha256_hex('managed-payloads-v1'), 0, 24);
for my $item (['Initialization lock', "$data/.blackcrab-payload-init-$key.lock"], ['Cache lease', "$cache/.lease"]) {
    my ($name, $path) = @$item;
    my $s = metadata($name, $path, 'file');
    check("$name ownership and mode", $s && $s->[4] == $> && $s->[3] == 1 && ($s->[2] & 0777) == 0600, 'Requires current user, one link and mode 0600');
    next unless $name eq 'Initialization lock' && $s;
    if (sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW)) {
        my $locked = flock($fh, LOCK_EX | LOCK_NB);
        check('Initialization lock available now', $locked, $locked ? 'Acquired and immediately released; file unchanged' : "Lock unavailable: $!");
        close $fh;
    } else { check('Initialization lock readable', 0, "Cannot open: $!"); }
}

if ($^O eq 'darwin' && -d $data && open(my $disk, '-|', '/usr/sbin/diskutil', 'info', '-plist', $data)) {
    local $/;
    my $plist = <$disk> // '';
    close $disk;
    if ($plist =~ m{<key>GlobalPermissionsEnabled</key>\s*<(true|false)\s*/>}) {
        check('Filesystem ownership enabled', $1 eq 'true', $1);
    } else { $report->{filesystemOwnership} = 'Could not determine; not treated as a passed check'; }
}
my @running;
if ($^O eq 'darwin' && open(my $ps, '-|', '/bin/ps', '-axo', 'pid=,comm=')) {
    while (my $line = <$ps>) {
        if ($line =~ /^\s*(\d+)\s+(.+\/Blackcrab\.app\/Contents\/MacOS\/blackcrab)\s*$/) {
            push @running, { pid => 0 + $1, executable => $2 };
        }
    }
    close $ps;
}
$report->{runningRootExecutables} = \@running;
$report->{note} = 'These checks cannot establish GUI startup success. No process was controlled and no repair was attempted.';
print JSON::PP->new->canonical->pretty->encode($report);
