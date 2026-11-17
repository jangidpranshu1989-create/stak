package app.stak.builder;

final class Phases {
    private Phases() {}
    static String label(String p) {
        if (p == null) return "Building";
        switch (p) {
            case "queued": return "Queued";
            case "questions": return "Preparing questions";
            case "blueprint": return "Planning";
            case "research": return "Researching";
            case "context": return "Reading context";
            case "build": return "Writing code";
            case "template": return "Designing";
            case "photos": return "Adding photos";
            case "qa": return "Testing";
            case "review": return "Reviewing";
            case "repair1": case "repair2": return "Fixing issues";
            case "publish": return "Publishing";
            default: return "Building";
        }
    }
    static String clock(long s) { return (s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
}
